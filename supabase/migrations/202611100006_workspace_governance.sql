begin;
alter table public.lv_workspaces
  add column active boolean not null default true,
  add column entitlement text not null default '' check (length(entitlement) <= 120),
  add column organization_details text not null default '' check (length(organization_details) <= 1000);
alter table public.lv_memberships drop constraint lv_memberships_role_check;
alter table public.lv_memberships add constraint lv_memberships_role_check check (role in ('owner','admin','member'));

-- The helper reads status without recursing through workspace and membership policies.
create function public.lv_workspace_active(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.lv_workspaces w join public.lv_memberships m on m.workspace_id=w.id
    where w.id=target and w.active and m.user_id=auth.uid()
  )
$$;
revoke all on function public.lv_workspace_active(uuid) from public, anon, authenticated;
grant execute on function public.lv_workspace_active(uuid) to authenticated;
alter policy lv_own_membership on public.lv_memberships using (
  user_id=(select auth.uid()) and public.lv_workspace_active(workspace_id)
);

create table public.lv_workspace_activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  actor_id uuid not null,
  subject_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);
create index lv_workspace_activity_recent on public.lv_workspace_activity(workspace_id, created_at desc, id desc);
alter table public.lv_workspace_activity enable row level security;
revoke all on public.lv_workspace_activity from public, anon, authenticated;
grant select on public.lv_workspace_activity to authenticated;
create policy lv_workspace_activity_read on public.lv_workspace_activity for select to authenticated using (
  exists(select 1 from public.lv_memberships m where m.workspace_id=lv_workspace_activity.workspace_id and m.role in ('owner','admin'))
  or exists(select 1 from public.lv_platform_admins a join public.lv_workspaces w on w.id=lv_workspace_activity.workspace_id
            where a.user_id=(select auth.uid()) and w.kind='agency')
);

create function public.lv_manage_workspace_access(target uuid, email_address text, access_role text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); target_user uuid; organization public.lv_workspaces; platform boolean; actor_role text;
begin
  select * into organization from public.lv_workspaces where id=target for update;
  select role into actor_role from public.lv_memberships where workspace_id=target and user_id=actor;
  platform := organization.kind='agency' and exists(select 1 from public.lv_platform_admins where user_id=actor);
  if organization.id is null or not organization.active or not coalesce(platform or actor_role in ('owner','admin'), false)
    then raise exception 'Workspace management unavailable'; end if;
  if access_role is null or access_role not in ('admin','member','revoke')
    or (access_role='admin' and not coalesce(platform or actor_role='owner', false))
    then raise exception 'Invalid access role'; end if;
  select id into target_user from auth.users where lower(email)=lower(btrim(email_address)) and email_confirmed_at is not null;
  if target_user is null then raise exception 'A confirmed Auth account is required'; end if;
  if target_user=actor or exists(select 1 from public.lv_memberships where workspace_id=target and user_id=target_user
    and (role='owner' or (role='admin' and not coalesce(platform or actor_role='owner',false))))
    then raise exception 'This membership cannot be changed'; end if;
  if access_role='revoke' then
    delete from public.lv_memberships where workspace_id=target and user_id=target_user;
  else
    insert into public.lv_memberships(workspace_id,user_id,role) values(target,target_user,access_role)
    on conflict(workspace_id,user_id) do update set role=excluded.role
    where lv_memberships.role is distinct from excluded.role;
  end if;
  if found then
    insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
      values(target,actor,target_user,'membership.' || access_role);
  end if;
end $$;

create function public.lv_configure_agency(target uuid, enabled boolean, access_entitlement text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid()) then
    raise exception 'Platform administrator required';
  end if;
  update public.lv_workspaces set active=enabled, entitlement=btrim(access_entitlement)
    where id=target and kind='agency';
  if not found then raise exception 'Agency workspace unavailable'; end if;
  insert into public.lv_workspace_activity(workspace_id,actor_id,action)
    values(target,auth.uid(),case when enabled then 'agency.enabled' else 'agency.suspended' end);
end $$;

create function public.lv_workspace_staff(target uuid) returns table(user_id uuid, email text, role text)
language sql stable security definer set search_path='' as $$
  select m.user_id, u.email::text, m.role
  from public.lv_memberships m join auth.users u on u.id=m.user_id
    join public.lv_workspaces w on w.id=m.workspace_id
  where w.id=target and (
    (w.active and exists(select 1 from public.lv_memberships a
      where a.workspace_id=w.id and a.user_id=auth.uid() and a.role in ('owner','admin')))
    or (w.kind='agency' and exists(select 1 from public.lv_platform_admins p where p.user_id=auth.uid()))
  )
  order by u.email;
$$;

create function public.lv_set_business_details(target uuid, details text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.lv_workspaces w set organization_details=btrim(details)
    where w.id=target and w.kind='business' and w.active and exists (
      select 1 from public.lv_memberships m where m.workspace_id=w.id and m.user_id=auth.uid()
        and m.role in ('owner','admin')
    );
  if not found then raise exception 'Business settings unavailable'; end if;
  insert into public.lv_workspace_activity(workspace_id,actor_id,action)
    values(target,auth.uid(),'business.settings');
end $$;

create or replace function public.lv_create_agency(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid())
    then raise exception 'Platform administrator required'; end if;
  insert into public.lv_workspaces(name,kind) values(trim(workspace_name),'agency') returning id into new_id;
  insert into public.lv_workspace_activity(workspace_id,actor_id,action) values(new_id,auth.uid(),'agency.created');
  return new_id;
end $$;

-- Keep the legacy grant endpoint closed so all changes go through the audited RPC.
revoke execute on function public.lv_agency_access(uuid,text,boolean) from authenticated;
revoke all on function public.lv_manage_workspace_access(uuid,text,text), public.lv_configure_agency(uuid,boolean,text),
  public.lv_workspace_staff(uuid), public.lv_set_business_details(uuid,text) from public,anon,authenticated;
grant execute on function public.lv_manage_workspace_access(uuid,text,text), public.lv_configure_agency(uuid,boolean,text),
  public.lv_workspace_staff(uuid), public.lv_set_business_details(uuid,text) to authenticated;

-- Security-definer operational RPCs cannot depend on RLS for membership checks.
create or replace function public.lv_retire_vehicle_watch(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.lv_vehicle_watchlist v set retired_at=now(), retired_by=auth.uid()
  where v.id=target_id and public.lv_workspace_active(v.workspace_id) and v.retired_at is null;
  if not found then raise exception 'Active watchlist entry unavailable'; end if;
end $$;

alter policy lv_cameras_insert on public.lv_cameras with check (
  exists(select 1 from public.lv_memberships m where m.workspace_id=lv_cameras.workspace_id and m.role in ('owner','admin'))
  or (public.lv_workspace_active(workspace_id) and exists(select 1 from public.lv_platform_admins))
);

create or replace function public.lv_change_record_status(target_id uuid, expected_status text, new_status text)
returns public.lv_records language plpgsql security definer set search_path='' as $$
declare current_record public.lv_records; actor uuid := auth.uid();
begin
  select r.* into current_record from public.lv_records r
    join public.lv_memberships m on m.workspace_id=r.workspace_id and m.user_id=actor
    where r.id=target_id and public.lv_workspace_active(r.workspace_id) and r.category in ('incident','investigation')
    for update of r;
  if not found then raise exception 'Record is unavailable'; end if;
  if current_record.status is distinct from expected_status then
    raise exception 'Record changed. Refresh before retrying';
  end if;
  if not coalesce(
    (expected_status='open' and new_status='in_review')
    or (expected_status='in_review' and new_status in ('open','resolved'))
    or (expected_status='resolved' and new_status='open'), false
  ) then raise exception 'Invalid status transition'; end if;
  update public.lv_records set status=new_status where id=target_id returning * into current_record;
  insert into public.lv_record_activity(record_id,actor_id,previous_status,next_status)
    values(target_id,actor,expected_status,new_status);
  return current_record;
end $$;
commit;
