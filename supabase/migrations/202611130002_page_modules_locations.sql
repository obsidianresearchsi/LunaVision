begin;

-- 1. Support GPS coordinates directly on enrolled agency subjects & inserts on cameras
alter table public.lv_agency_subjects
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.lv_agency_subjects drop constraint if exists lv_subject_coordinates;
alter table public.lv_agency_subjects add constraint lv_subject_coordinates check (
  (latitude is null and longitude is null)
  or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
);

grant insert(latitude, longitude) on public.lv_cameras to authenticated;
grant update(latitude, longitude, last_known_location) on public.lv_agency_subjects to authenticated;

drop policy if exists lv_subject_map_position on public.lv_agency_subjects;
create policy lv_subject_map_position on public.lv_agency_subjects for update to authenticated using (
  public.lv_agency_member(workspace_id)
  and public.lv_workspace_permission(workspace_id, 'watchlist_write')
) with check (
  public.lv_agency_member(workspace_id)
  and public.lv_workspace_permission(workspace_id, 'watchlist_write')
);

-- 2. Allow granular non-admin sidebar page identifiers in allowed_modules alongside legacy coarse module keys
alter table public.lv_memberships drop constraint if exists lv_memberships_allowed_modules_check;
alter table public.lv_memberships add constraint lv_memberships_allowed_modules_check check (
  allowed_modules <@ array[
    'monitor','analytics','records','evidence','vehicles','access',
    'command','intelligence','cameras','camera_config','playback','alerts',
    'vehicle_registry','fleet','rules','overview','gallery','intel',
    'enrollment','dossiers','search_history','watchlist','history','faces'
  ]::text[]
);

create or replace function public.lv_has_scope(target uuid, module_name text, required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.lv_memberships m
    join public.lv_workspaces w on w.id=m.workspace_id
    where w.id=target and w.active and m.user_id=auth.uid() and m.clearance>=required_clearance
      and (
        m.role in ('owner','admin')
        or module_name = any(m.allowed_modules)
        or (module_name = 'monitor' and m.allowed_modules && array['command','cameras','camera_config','alerts','fleet','intel']::text[])
        or (module_name = 'analytics' and m.allowed_modules && array['intelligence','playback','rules','overview','history']::text[])
        or (module_name = 'records' and m.allowed_modules && array['gallery','enrollment','dossiers','search_history','faces']::text[])
        or (module_name = 'vehicles' and m.allowed_modules && array['vehicle_registry','watchlist']::text[])
      )
  )
$$;

create or replace function public.lv_set_staff_access(target uuid,email_address text,access_role text,access_clearance integer,modules text[]) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); recipient uuid; team public.lv_workspaces; manager public.lv_memberships; is_platform boolean;
begin
  select * into team from public.lv_workspaces where id=target for update;
  select * into manager from public.lv_memberships where workspace_id=target and user_id=actor;
  is_platform:=team.kind='agency' and exists(select 1 from public.lv_platform_admins where user_id=actor);
  if team.id is null or not team.active or not (is_platform or coalesce(manager.role in ('owner','admin'),false)) then raise exception 'Workspace management unavailable'; end if;
  if access_role is null or access_role not in ('admin','supervisor','investigator','member','viewer','revoke')
    or access_clearance is null or access_clearance not between 0 and 3
    or (not is_platform and access_clearance>manager.clearance)
    or modules is null or array_position(modules,null) is not null
    or not modules <@ array[
      'monitor','analytics','records','evidence','vehicles','access',
      'command','intelligence','cameras','camera_config','playback','alerts',
      'vehicle_registry','fleet','rules','overview','gallery','intel',
      'enrollment','dossiers','search_history','watchlist','history','faces'
    ]::text[]
    or (access_role='admin' and not (is_platform or manager.role='owner')) then raise exception 'Invalid role, clearance or module access'; end if;
  select id into recipient from auth.users where lower(email)=lower(btrim(email_address)) and email_confirmed_at is not null;
  if recipient is null then raise exception 'A confirmed account is required. Create a staff account first.'; end if;
  if recipient=actor or exists(select 1 from public.lv_memberships where workspace_id=target and user_id=recipient
    and (role='owner' or (role='admin' and not (is_platform or manager.role='owner')))) then raise exception 'This membership cannot be changed'; end if;
  if access_role='revoke' then delete from public.lv_memberships where workspace_id=target and user_id=recipient;
  else
    insert into public.lv_memberships(workspace_id,user_id,role,clearance,allowed_modules) values(target,recipient,access_role,access_clearance,modules)
    on conflict(workspace_id,user_id) do update set role=excluded.role,clearance=excluded.clearance,allowed_modules=excluded.allowed_modules;
  end if;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(target,actor,recipient,'membership.'||access_role||'.clearance_'||access_clearance);
end $$;

commit;

