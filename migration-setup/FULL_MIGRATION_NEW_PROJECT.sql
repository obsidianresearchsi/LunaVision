-- ============================================================================
-- Lunar Vision Platform — Consolidated Full Database Migration (New Project)
-- Generated cleanly in chronological dependency order from supabase/migrations/
-- Steps included: 01 through 17 (17 migrations)
-- Target: Brand-new empty Supabase PostgreSQL project.
-- WARNING: Do NOT run this entire script on an already-migrated database.
--          Use migration-setup/ordered-migrations/ for incremental upgrades.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 01/17: 202611100001_workspaces.sql
-- ----------------------------------------------------------------------------
begin;
create table public.lv_workspaces (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 2 and 100),
 kind text not null check (kind in ('agency','business'))
);
create table public.lv_memberships (
 workspace_id uuid references public.lv_workspaces on delete cascade,
 user_id uuid references auth.users on delete cascade,
 role text not null check (role in ('owner','member')),
 primary key(workspace_id,user_id)
);
create table public.lv_platform_admins (user_id uuid primary key references auth.users on delete cascade);
create table public.lv_records (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.lv_workspaces on delete cascade,
 category text not null check (category in ('investigation','incident','site')),
 title text not null check (length(trim(title)) between 2 and 140),
 details text not null default '' check(length(details)<=4000),
 created_at timestamptz not null default now()
);
create index lv_records_workspace on public.lv_records(workspace_id,created_at desc);
alter table public.lv_workspaces enable row level security;
alter table public.lv_memberships enable row level security;
alter table public.lv_platform_admins enable row level security;
alter table public.lv_records enable row level security;
revoke all on public.lv_workspaces, public.lv_memberships, public.lv_platform_admins, public.lv_records from public, anon, authenticated;
grant select on public.lv_workspaces, public.lv_memberships, public.lv_platform_admins, public.lv_records to authenticated;
grant insert(workspace_id,category,title,details) on public.lv_records to authenticated;
create policy lv_own_membership on public.lv_memberships for select to authenticated using (user_id=(select auth.uid()));
create policy lv_own_admin on public.lv_platform_admins for select to authenticated using (user_id=(select auth.uid()));
create policy lv_workspace_read on public.lv_workspaces for select to authenticated using (
 exists(select 1 from public.lv_memberships m where m.workspace_id=id and m.user_id=(select auth.uid()))
 or (kind='agency' and exists(select 1 from public.lv_platform_admins a where a.user_id=(select auth.uid())))
);
create policy lv_record_read on public.lv_records for select to authenticated using (
 exists(select 1 from public.lv_memberships m where m.workspace_id=lv_records.workspace_id and m.user_id=(select auth.uid()))
);
create policy lv_record_create on public.lv_records for insert to authenticated with check (
 exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id
 where m.workspace_id=lv_records.workspace_id and m.user_id=(select auth.uid())
 and ((w.kind='agency' and category='investigation') or (w.kind='business' and category in ('incident','site'))))
);
create function public.lv_create_business(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid; actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
 then raise exception 'A confirmed account is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
 if exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id where m.user_id=actor and w.kind='business' and m.role='owner')
 then raise exception 'This account already owns a business workspace'; end if;
 insert into public.lv_workspaces(name,kind) values(trim(workspace_name),'business') returning id into new_id;
 insert into public.lv_memberships values(new_id,actor,'owner');
 return new_id;
end $$;
create function public.lv_create_agency(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
 if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid())
 then raise exception 'Platform administrator required'; end if;
 insert into public.lv_workspaces(name,kind) values(trim(workspace_name),'agency') returning id into new_id;
 return new_id;
end $$;
create function public.lv_agency_access(agency_id uuid, account_email text, allow_access boolean) returns void
language plpgsql security definer set search_path='' as $$
declare member_id uuid;
begin
 if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid())
 then raise exception 'Platform administrator required'; end if;
 if not exists(select 1 from public.lv_workspaces where id=agency_id and kind='agency')
 then raise exception 'Agency workspace required'; end if;
 select id into member_id from auth.users where lower(email)=lower(trim(account_email)) and email_confirmed_at is not null;
 if member_id is null then raise exception 'A confirmed Auth account is required'; end if;
 if allow_access then insert into public.lv_memberships values(agency_id,member_id,'member') on conflict do nothing;
 else delete from public.lv_memberships where workspace_id=agency_id and user_id=member_id; end if;
end $$;
revoke all on function public.lv_create_business(text),public.lv_create_agency(text),public.lv_agency_access(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.lv_create_business(text),public.lv_create_agency(text),public.lv_agency_access(uuid,text,boolean) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 02/17: 202611100002_cameras.sql
-- ----------------------------------------------------------------------------
begin;
create table public.lv_cameras (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.lv_workspaces on delete cascade,
 name text not null check(length(trim(name)) between 2 and 100),
 location text not null default '' check(length(location)<=200),
 playback_url text not null check (
   length(playback_url)<=2048 and
   playback_url ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/[^[:space:]?#]*$'
 ),
 created_at timestamptz not null default now()
);
create index lv_cameras_workspace on public.lv_cameras(workspace_id);
alter table public.lv_cameras enable row level security;
revoke all on public.lv_cameras from public, anon, authenticated;
grant select on public.lv_cameras to authenticated;
grant insert(workspace_id,name,location,playback_url) on public.lv_cameras to authenticated;
create policy lv_cameras_read on public.lv_cameras for select to authenticated using (
 exists(select 1 from public.lv_memberships m
 where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()))
);
create policy lv_cameras_insert on public.lv_cameras for insert to authenticated with check (
 exists(select 1 from public.lv_memberships m
 where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')
 or (
 exists(select 1 from public.lv_memberships m where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()))
 and exists(select 1 from public.lv_platform_admins a where a.user_id=(select auth.uid()))
 )
);
commit;


-- ----------------------------------------------------------------------------
-- STEP 03/17: 202611100003_legacy_quarantine.sql
-- ----------------------------------------------------------------------------
begin;

-- Guarded wrapper so this step succeeds cleanly on both a brand-new empty
-- database (where legacy EagleEye v1 tables do not exist) and an upgraded DB.
do $$
declare
  tbl text;
  legacy_tables text[] := array[
    'audit_logs', 'cameras', 'case_activities',
    'case_linked_searches', 'case_linked_subjects', 'case_notes',
    'cases', 'detections', 'notifications', 'settings',
    'surveillance_alerts', 'suspects', 'users', 'watchlist'
  ];
begin
  foreach tbl in array legacy_tables loop
    if to_regclass('public.' || tbl) is not null then
      execute format('revoke all privileges on table public.%I from public, anon, authenticated', tbl);
    end if;
  end loop;
end $$;

update storage.buckets set public = false where id = 'mugshots';

drop policy if exists lv_legacy_mugshots_block on storage.objects;
create policy lv_legacy_mugshots_block
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'mugshots')
  with check (bucket_id <> 'mugshots');

commit;


-- ----------------------------------------------------------------------------
-- STEP 04/17: 202611100004_record_status.sql
-- ----------------------------------------------------------------------------
begin;

alter table public.lv_records add column status text not null default 'open'
  check (status in ('open','in_review','resolved'));

create table public.lv_record_activity (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.lv_records on delete cascade,
  actor_id uuid references auth.users on delete set null,
  previous_status text not null,
  next_status text not null,
  created_at timestamptz not null default now()
);
create index lv_record_activity_record on public.lv_record_activity(record_id, created_at desc);
alter table public.lv_record_activity enable row level security;
revoke all on public.lv_record_activity from public, anon, authenticated;
grant select on public.lv_record_activity to authenticated;
create policy lv_record_activity_read on public.lv_record_activity for select to authenticated using (
  exists (select 1 from public.lv_records r where r.id = record_id)
);

create function public.lv_change_record_status(target_id uuid, expected_status text, new_status text)
returns public.lv_records language plpgsql security definer set search_path='' as $$
declare current_record public.lv_records; actor uuid := auth.uid();
begin
  select r.* into current_record from public.lv_records r
    join public.lv_memberships m on m.workspace_id=r.workspace_id and m.user_id=actor
    where r.id=target_id and r.category in ('incident','investigation')
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
revoke all on function public.lv_change_record_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.lv_change_record_status(uuid,text,text) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 05/17: 202611100005_vehicle_watchlist.sql
-- ----------------------------------------------------------------------------
begin;

create table public.lv_vehicle_watchlist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  plate text not null check (plate collate "C" ~ '^[A-Z0-9]{2,12}$'),
  reason text not null check (reason in ('stolen', 'watchlist')),
  case_reference text not null check (length(btrim(case_reference)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  retired_at timestamptz,
  retired_by uuid
);

create unique index lv_vehicle_watchlist_active_plate
  on public.lv_vehicle_watchlist(workspace_id, plate) where retired_at is null;
create index lv_vehicle_watchlist_workspace_date
  on public.lv_vehicle_watchlist(workspace_id, created_at desc);

alter table public.lv_vehicle_watchlist enable row level security;
revoke all on public.lv_vehicle_watchlist from public, anon, authenticated;
grant select on public.lv_vehicle_watchlist to authenticated;
grant insert(workspace_id, plate, reason, case_reference) on public.lv_vehicle_watchlist to authenticated;

create policy lv_vehicle_watchlist_read on public.lv_vehicle_watchlist for select to authenticated using (
  exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = lv_vehicle_watchlist.workspace_id and m.user_id = (select auth.uid()) and w.kind = 'agency'
  )
);

create policy lv_vehicle_watchlist_add on public.lv_vehicle_watchlist for insert to authenticated with check (
  exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = lv_vehicle_watchlist.workspace_id and m.user_id = (select auth.uid()) and w.kind = 'agency'
  )
);

create function public.lv_retire_vehicle_watch(target_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.lv_vehicle_watchlist v set retired_at = now(), retired_by = auth.uid()
  where v.id = target_id and v.retired_at is null and exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = v.workspace_id and m.user_id = auth.uid() and w.kind = 'agency'
  );
  if not found then raise exception 'Active watchlist entry unavailable'; end if;
end $$;

revoke all on function public.lv_retire_vehicle_watch(uuid) from public, anon, authenticated;
grant execute on function public.lv_retire_vehicle_watch(uuid) to authenticated;

commit;


-- ----------------------------------------------------------------------------
-- STEP 06/17: 202611100006_workspace_governance.sql
-- ----------------------------------------------------------------------------
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


-- ----------------------------------------------------------------------------
-- STEP 07/17: 202611100007_video_observations.sql
-- ----------------------------------------------------------------------------
begin;
create table public.lv_video_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  camera_id uuid references public.lv_cameras on delete set null,
  source text not null check (source in ('camera','file')),
  frame_seconds numeric(12,2) not null check (frame_seconds between 0 and 315360000),
  summary text not null check (length(btrim(summary)) between 1 and 1500),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
create index lv_video_observations_recent on public.lv_video_observations(workspace_id, created_at desc, id desc);
alter table public.lv_video_observations enable row level security;
revoke all on public.lv_video_observations from public, anon, authenticated;
grant select on public.lv_video_observations to authenticated;
grant insert(workspace_id,camera_id,source,frame_seconds,summary) on public.lv_video_observations to authenticated;
create policy lv_video_observations_read on public.lv_video_observations for select to authenticated
  using (public.lv_workspace_active(workspace_id));
create policy lv_video_observations_insert on public.lv_video_observations for insert to authenticated
  with check (
    public.lv_workspace_active(workspace_id)
    and (
      (source='file' and camera_id is null)
      or (source='camera' and exists (
        select 1 from public.lv_cameras c
        where c.id=lv_video_observations.camera_id and c.workspace_id=lv_video_observations.workspace_id
      ))
    )
  );
commit;


-- ----------------------------------------------------------------------------
-- STEP 08/17: 202611100008_corrective_actions.sql
-- ----------------------------------------------------------------------------
begin;
create table public.lv_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.lv_records on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 160),
  responsible_team text not null check (length(btrim(responsible_team)) between 1 and 100),
  due_on date not null check (isfinite(due_on)),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  completed_at timestamptz,
  completed_by uuid
);
create index lv_corrective_actions_incident on public.lv_corrective_actions(incident_id, due_on, id);
alter table public.lv_corrective_actions enable row level security;
revoke all on public.lv_corrective_actions from public,anon,authenticated;
grant select on public.lv_corrective_actions to authenticated;
grant insert(incident_id,title,responsible_team,due_on) on public.lv_corrective_actions to authenticated;
create policy lv_corrective_actions_read on public.lv_corrective_actions for select to authenticated using (
  exists (select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=incident_id and r.category='incident' and w.kind='business')
);
create policy lv_corrective_actions_add on public.lv_corrective_actions for insert to authenticated with check (
  exists (select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=incident_id and r.category='incident' and w.kind='business')
);
create function public.lv_complete_corrective_action(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.lv_corrective_actions a set completed_at=now(),completed_by=auth.uid()
  where a.id=target and a.completed_at is null and exists (
    select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=a.incident_id and r.category='incident' and w.kind='business'
      and public.lv_workspace_active(w.id)
  );
  if not found then raise exception 'Open corrective action unavailable'; end if;
end $$;
revoke all on function public.lv_complete_corrective_action(uuid) from public,anon,authenticated;
grant execute on function public.lv_complete_corrective_action(uuid) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 09/17: 202611110001_command_map.sql
-- ----------------------------------------------------------------------------
begin;

alter table public.lv_cameras
  add column latitude double precision,
  add column longitude double precision,
  add constraint lv_camera_coordinates check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
  );

alter table public.lv_records
  add column latitude double precision,
  add column longitude double precision,
  add constraint lv_investigation_coordinates check (
    (latitude is null and longitude is null)
    or (category = 'investigation' and latitude is not null and longitude is not null
        and latitude between -90 and 90 and longitude between -180 and 180)
  );

grant update(latitude, longitude) on public.lv_cameras, public.lv_records to authenticated;

create policy lv_camera_map_position on public.lv_cameras for update to authenticated using (
  exists (select 1 from public.lv_workspaces w where w.id = lv_cameras.workspace_id and w.kind = 'agency')
  and (
    exists (select 1 from public.lv_memberships m where m.workspace_id = lv_cameras.workspace_id and m.role in ('owner','admin'))
    or (public.lv_workspace_active(workspace_id) and exists (select 1 from public.lv_platform_admins))
  )
);

create policy lv_investigation_map_position on public.lv_records for update to authenticated using (
  category = 'investigation' and public.lv_workspace_active(workspace_id)
  and exists (select 1 from public.lv_workspaces w where w.id = lv_records.workspace_id and w.kind = 'agency')
);

commit;


-- ----------------------------------------------------------------------------
-- STEP 10/17: 202611110002_agency_operations.sql
-- ----------------------------------------------------------------------------
begin;

create function public.lv_agency_member(target uuid, manager boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.lv_workspaces w join public.lv_memberships m on m.workspace_id=w.id
    where w.id=target and w.kind='agency' and w.active and m.user_id=auth.uid()
    and (not manager or m.role in ('owner','admin')))
$$;
revoke all on function public.lv_agency_member(uuid,boolean) from public,anon,authenticated;
grant execute on function public.lv_agency_member(uuid,boolean) to authenticated;

create table public.lv_agency_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  name text not null check(length(btrim(name)) between 2 and 100),
  object_label text not null check(object_label in ('car','truck','bus','motorcycle','bicycle','boat','airplane','train','fire hydrant','backpack','suitcase')),
  minimum_confidence numeric not null check(minimum_confidence between 0.5 and 1),
  severity text not null check(severity in ('low','medium','high')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.lv_agency_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  title text not null check(length(btrim(title)) between 2 and 140),
  details text not null default '' check(length(details)<=4000),
  severity text not null check(severity in ('low','medium','high')),
  status text not null default 'open' check(status in ('open','acknowledged','resolved')),
  observation_id uuid references public.lv_video_observations,
  rule_id uuid references public.lv_agency_rules,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(observation_id,rule_id)
);
create table public.lv_agency_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  record_id uuid not null references public.lv_records,
  title text not null check(length(btrim(title)) between 2 and 140),
  notes text not null default '' check(length(notes)<=4000),
  storage_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 240),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf','video/mp4')),
  byte_size integer not null check(byte_size between 1 and 26214400),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index lv_agency_alerts_recent on public.lv_agency_alerts(workspace_id,created_at desc,id desc);
create index lv_agency_evidence_recent on public.lv_agency_evidence(workspace_id,created_at desc,id desc);
create index lv_agency_rules_workspace on public.lv_agency_rules(workspace_id);

alter table public.lv_agency_rules enable row level security;
alter table public.lv_agency_alerts enable row level security;
alter table public.lv_agency_evidence enable row level security;
revoke all on public.lv_agency_rules,public.lv_agency_alerts,public.lv_agency_evidence from public,anon,authenticated;
grant select on public.lv_agency_rules,public.lv_agency_alerts,public.lv_agency_evidence to authenticated;
grant insert(workspace_id,name,object_label,minimum_confidence,severity,enabled) on public.lv_agency_rules to authenticated;
grant update(name,minimum_confidence,severity,enabled) on public.lv_agency_rules to authenticated;
grant insert(workspace_id,title,details,severity) on public.lv_agency_alerts to authenticated;
grant insert(workspace_id,record_id,title,notes,storage_path,file_name,mime_type,byte_size,sha256) on public.lv_agency_evidence to authenticated;
create policy lv_rules_read on public.lv_agency_rules for select to authenticated using(public.lv_agency_member(workspace_id));
create policy lv_rules_insert on public.lv_agency_rules for insert to authenticated with check(public.lv_agency_member(workspace_id,true));
create policy lv_rules_update on public.lv_agency_rules for update to authenticated using(public.lv_agency_member(workspace_id,true));
create policy lv_alerts_read on public.lv_agency_alerts for select to authenticated using(public.lv_agency_member(workspace_id));
create policy lv_alerts_insert on public.lv_agency_alerts for insert to authenticated with check(public.lv_agency_member(workspace_id));
create policy lv_evidence_read on public.lv_agency_evidence for select to authenticated using(public.lv_agency_member(workspace_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-agency-evidence','lv-agency-evidence',false,26214400,array['image/jpeg','image/png','application/pdf','video/mp4']);
create policy lv_evidence_objects_read on storage.objects for select to authenticated using(
  bucket_id='lv-agency-evidence' and (
    exists(select 1 from public.lv_agency_evidence e where e.storage_path=storage.objects.name and public.lv_agency_member(e.workspace_id))
    or ((storage.foldername(storage.objects.name))[2]=auth.uid()::text and exists(select 1 from public.lv_workspaces w
      where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)))
  )
);
create policy lv_evidence_objects_upload on storage.objects for insert to authenticated with check(
  bucket_id='lv-agency-evidence' and (storage.foldername(storage.objects.name))[2]=auth.uid()::text
  and exists(select 1 from public.lv_workspaces w where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
create policy lv_evidence_objects_cleanup on storage.objects for delete to authenticated using(
  bucket_id='lv-agency-evidence' and (storage.foldername(storage.objects.name))[2]=auth.uid()::text
  and not exists(select 1 from public.lv_agency_evidence e where e.storage_path=storage.objects.name)
  and exists(select 1 from public.lv_workspaces w where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
-- Security-definer validation can inspect the newly uploaded object before it has an evidence row.
create function public.lv_valid_evidence(target uuid, case_id uuid, path text, bytes integer, mime text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.lv_agency_member(target) and exists(select 1 from public.lv_records r
   where r.id=case_id and r.workspace_id=target and r.category='investigation')
 and split_part(path,'/',1)=target::text and split_part(path,'/',2)=auth.uid()::text
 and exists(select 1 from storage.objects o where o.bucket_id='lv-agency-evidence' and o.name=path
   and (o.metadata->>'size')::bigint=bytes and o.metadata->>'mimetype'=mime)
$$;
revoke all on function public.lv_valid_evidence(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.lv_valid_evidence(uuid,uuid,text,integer,text) to authenticated;
create policy lv_evidence_insert on public.lv_agency_evidence for insert to authenticated with check(
  public.lv_valid_evidence(workspace_id,record_id,storage_path,byte_size,mime_type)
);

create function public.lv_agency_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
 values(new.workspace_id,auth.uid(),new.id,tg_table_name||'.'||lower(tg_op));
 return new;
end $$;
revoke all on function public.lv_agency_audit() from public,anon,authenticated;
create trigger lv_rules_audit after insert or update on public.lv_agency_rules for each row execute function public.lv_agency_audit();
create trigger lv_alerts_audit after insert or update on public.lv_agency_alerts for each row execute function public.lv_agency_audit();
create trigger lv_evidence_audit after insert on public.lv_agency_evidence for each row execute function public.lv_agency_audit();

create function public.lv_transition_alert(target uuid, expected text, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_alerts;
begin
 select * into item from public.lv_agency_alerts where id=target for update;
 if item.id is null or not public.lv_agency_member(item.workspace_id) then raise exception 'Alert unavailable'; end if;
 if item.status<>expected then raise exception 'Alert changed. Refresh and retry.'; end if;
 if next_status is null or not ((expected='open' and next_status='acknowledged')
   or (expected='acknowledged' and next_status='resolved') or (expected='resolved' and next_status='open'))
   then raise exception 'Invalid alert transition'; end if;
 update public.lv_agency_alerts set status=next_status,updated_at=now() where id=target;
end $$;
revoke all on function public.lv_transition_alert(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lv_transition_alert(uuid,text,text) to authenticated;

alter table public.lv_video_observations add column detections jsonb not null default '[]'::jsonb;
grant insert(detections) on public.lv_video_observations to authenticated;
create function public.lv_observation_rules() returns trigger language plpgsql security definer set search_path='' as $$
declare detection jsonb;
begin
 if jsonb_typeof(new.detections)<>'array' or jsonb_array_length(new.detections)>100 then raise exception 'Invalid detections'; end if;
 for detection in select value from jsonb_array_elements(new.detections) loop
   if jsonb_typeof(detection->'label') is distinct from 'string'
     or jsonb_typeof(detection->'score') is distinct from 'number'
     or length(detection->>'label')>80 or (detection->>'score')::numeric not between 0 and 1
     then raise exception 'Invalid detection'; end if;
 end loop;
 if public.lv_agency_member(new.workspace_id) then
   insert into public.lv_agency_alerts(workspace_id,title,details,severity,observation_id,rule_id,created_by)
   select new.workspace_id,r.name,'Saved observation: '||new.summary,r.severity,new.id,r.id,new.created_by
   from public.lv_agency_rules r where r.workspace_id=new.workspace_id and r.enabled and exists(
     select 1 from jsonb_array_elements(new.detections) d where d->>'label'=r.object_label
     and (d->>'score')::numeric>=r.minimum_confidence);
 end if;
 return new;
end $$;
revoke all on function public.lv_observation_rules() from public,anon,authenticated;
create trigger lv_observation_rule_evaluation after insert on public.lv_video_observations for each row execute function public.lv_observation_rules();

grant update(name,location,playback_url) on public.lv_cameras to authenticated;
-- Existing map-update policy restricts agency camera updates to managers.
commit;


-- ----------------------------------------------------------------------------
-- STEP 11/17: 202611110003_operation_reliability.sql
-- ----------------------------------------------------------------------------
begin;

alter table public.lv_agency_rules
  add column revision bigint not null default 1,
  add column cooldown_seconds integer not null default 60 check(cooldown_seconds between 15 and 3600);
create index lv_alerts_rule_recent on public.lv_agency_alerts(rule_id,created_at desc);

create function public.lv_update_agency_rule(target uuid, expected_revision bigint, rule_name text,
  threshold numeric, priority text, active boolean, repeat_seconds integer) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_rules;
begin
 select * into item from public.lv_agency_rules where id=target for update;
 if item.id is null or not public.lv_agency_member(item.workspace_id,true) then raise exception 'Rule management unavailable'; end if;
 if expected_revision is null or item.revision<>expected_revision then raise exception 'Rule changed. Refresh before editing.'; end if;
 update public.lv_agency_rules set name=btrim(rule_name),minimum_confidence=threshold,severity=priority,
   enabled=active,cooldown_seconds=repeat_seconds,revision=revision+1 where id=target;
end $$;
revoke all on function public.lv_update_agency_rule(uuid,bigint,text,numeric,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.lv_update_agency_rule(uuid,bigint,text,numeric,text,boolean,integer) to authenticated;
revoke update on public.lv_agency_rules from authenticated;
revoke update(name,minimum_confidence,severity,enabled) on public.lv_agency_rules from authenticated;
grant insert(cooldown_seconds) on public.lv_agency_rules to authenticated;

alter table public.lv_cameras add column revision bigint not null default 1;
create function public.lv_camera_revision() returns trigger language plpgsql set search_path='' as $$
begin new.revision=old.revision+1; return new; end $$;
revoke all on function public.lv_camera_revision() from public,anon,authenticated;
create trigger lv_camera_revision before update on public.lv_cameras for each row execute function public.lv_camera_revision();
create trigger lv_camera_update_audit after update on public.lv_cameras for each row execute function public.lv_agency_audit();
create function public.lv_update_agency_camera(target uuid,expected_revision bigint,device_name text,device_location text,endpoint text)
returns void language plpgsql security definer set search_path='' as $$
declare item public.lv_cameras;
begin
 select * into item from public.lv_cameras where id=target for update;
 if item.id is null or not public.lv_agency_member(item.workspace_id,true) then raise exception 'Device management unavailable'; end if;
 if expected_revision is null or item.revision<>expected_revision then raise exception 'Device changed. Refresh before editing.'; end if;
 update public.lv_cameras set name=btrim(device_name),location=btrim(device_location),playback_url=endpoint where id=target;
end $$;
revoke all on function public.lv_update_agency_camera(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.lv_update_agency_camera(uuid,bigint,text,text,text) to authenticated;
revoke update(name,location,playback_url) on public.lv_cameras from authenticated;

alter table public.lv_video_observations add column request_id uuid not null default gen_random_uuid();
create unique index lv_observation_request on public.lv_video_observations(workspace_id,created_by,request_id);
grant insert(request_id) on public.lv_video_observations to authenticated;
create function public.lv_save_observation(target uuid,event_id uuid,camera uuid,frame_time numeric,description text,objects jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare saved public.lv_video_observations;
begin
 if not public.lv_workspace_active(target) or event_id is null then raise exception 'Observation storage unavailable'; end if;
 if camera is not null and not exists(select 1 from public.lv_cameras c where c.id=camera and c.workspace_id=target)
   then raise exception 'Camera unavailable'; end if;
 insert into public.lv_video_observations(workspace_id,request_id,camera_id,source,frame_seconds,summary,detections,created_by)
 values(target,event_id,camera,case when camera is null then 'file' else 'camera' end,frame_time,description,objects,auth.uid())
 on conflict(workspace_id,created_by,request_id) do nothing returning * into saved;
 if saved.id is null then
   select * into saved from public.lv_video_observations where workspace_id=target and created_by=auth.uid() and request_id=event_id;
 end if;
 if saved.id is null or saved.camera_id is distinct from camera or saved.frame_seconds is distinct from round(frame_time,2)
   or saved.summary is distinct from description or saved.detections is distinct from objects
   then raise exception 'Observation request was already used for different content'; end if;
 return saved.id;
end $$;
revoke all on function public.lv_save_observation(uuid,uuid,uuid,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.lv_save_observation(uuid,uuid,uuid,numeric,text,jsonb) to authenticated;

create or replace function public.lv_observation_rules() returns trigger language plpgsql security definer set search_path='' as $$
declare detection jsonb; rule public.lv_agency_rules;
begin
 if jsonb_typeof(new.detections)<>'array' or jsonb_array_length(new.detections)>100 then raise exception 'Invalid detections'; end if;
 for detection in select value from jsonb_array_elements(new.detections) loop
   if jsonb_typeof(detection->'label') is distinct from 'string' or jsonb_typeof(detection->'score') is distinct from 'number'
     or length(detection->>'label')>80 or (detection->>'score')::numeric not between 0 and 1 then raise exception 'Invalid detection'; end if;
 end loop;
 if public.lv_agency_member(new.workspace_id) then
   -- Lock matching rules in a fixed order to serialize concurrent observations and avoid alert floods.
   for rule in select r.* from public.lv_agency_rules r where r.workspace_id=new.workspace_id and r.enabled and exists(
     select 1 from jsonb_array_elements(new.detections) d where d->>'label'=r.object_label and (d->>'score')::numeric>=r.minimum_confidence)
     order by r.id for update
   loop
     if not exists(select 1 from public.lv_agency_alerts a join public.lv_video_observations o on o.id=a.observation_id
       where a.rule_id=rule.id and o.camera_id is not distinct from new.camera_id
         and a.created_at>clock_timestamp()-make_interval(secs=>rule.cooldown_seconds)) then
       insert into public.lv_agency_alerts(workspace_id,title,details,severity,observation_id,rule_id,created_by)
       values(new.workspace_id,rule.name,'Saved observation: '||new.summary,rule.severity,new.id,rule.id,new.created_by);
     end if;
   end loop;
 end if;
 return new;
end $$;

create function public.lv_register_evidence(target uuid,case_id uuid,evidence_title text,evidence_notes text,
  path text,original_name text,mime text,bytes integer,file_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved public.lv_agency_evidence;
begin
 if not public.lv_agency_member(target) then raise exception 'Evidence registration unavailable'; end if;
 select * into saved from public.lv_agency_evidence where storage_path=path;
 if saved.id is null then
   if not public.lv_valid_evidence(target,case_id,path,bytes,mime) then raise exception 'Uploaded file or investigation could not be verified'; end if;
   insert into public.lv_agency_evidence(workspace_id,record_id,title,notes,storage_path,file_name,mime_type,byte_size,sha256,created_by)
   values(target,case_id,btrim(evidence_title),btrim(evidence_notes),path,original_name,mime,bytes,file_hash,auth.uid())
   on conflict(storage_path) do nothing returning * into saved;
   if saved.id is null then select * into saved from public.lv_agency_evidence where storage_path=path; end if;
 end if;
 if saved.id is null or saved.workspace_id<>target or saved.created_by<>auth.uid() or saved.record_id is distinct from case_id
   or saved.title is distinct from btrim(evidence_title) or saved.notes is distinct from btrim(evidence_notes)
   or saved.file_name is distinct from original_name or saved.mime_type is distinct from mime or saved.byte_size is distinct from bytes
   or saved.sha256 is distinct from file_hash then raise exception 'Evidence registration does not match the stored original'; end if;
 return saved.id;
end $$;
revoke all on function public.lv_register_evidence(uuid,uuid,text,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.lv_register_evidence(uuid,uuid,text,text,text,text,text,integer,text) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 12/17: 202611120001_video_intelligence.sql
-- ----------------------------------------------------------------------------
begin;

-- ---------------------------------------------------------------------------
-- 1. Roles and permissions
-- ---------------------------------------------------------------------------
alter table public.lv_memberships drop constraint if exists lv_memberships_role_check;
alter table public.lv_memberships add constraint lv_memberships_role_check
  check (role in ('owner','admin','supervisor','investigator','member'));

create function public.lv_normalize_plate(value text) returns text
language sql immutable set search_path='' as $$
  select upper(regexp_replace(coalesce(value,''), '[^A-Za-z0-9]', '', 'g'))
$$;
grant execute on function public.lv_normalize_plate(text) to authenticated;

create function public.lv_role_can(member_role text, permission text) returns boolean
language sql immutable set search_path='' as $$
  select case permission
    when 'configure' then member_role in ('owner','admin')
    when 'watchlist_write' then member_role in ('owner','admin','supervisor','investigator')
    when 'watchlist_archive' then member_role in ('owner','admin','supervisor')
    when 'watchlist_delete' then member_role in ('owner','admin')
    when 'registry_write' then member_role in ('owner','admin','supervisor')
    when 'alert_ack' then member_role in ('owner','admin','supervisor','investigator','member')
    when 'alert_resolve' then member_role in ('owner','admin','supervisor','investigator','member')
    else false end
$$;
grant execute on function public.lv_role_can(text,text) to authenticated;

create function public.lv_workspace_permission(target uuid, permission text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id
    where m.workspace_id=target and m.user_id=auth.uid() and w.active and public.lv_role_can(m.role,permission))
$$;
revoke all on function public.lv_workspace_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.lv_workspace_permission(uuid,text) to authenticated;

-- Supervisors and investigators can be assigned by owners, administrators and platform administrators.
create or replace function public.lv_manage_workspace_access(target uuid, email_address text, access_role text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); target_user uuid; organization public.lv_workspaces; platform boolean; actor_role text;
begin
  select * into organization from public.lv_workspaces where id=target for update;
  select role into actor_role from public.lv_memberships where workspace_id=target and user_id=actor;
  platform := organization.kind='agency' and exists(select 1 from public.lv_platform_admins where user_id=actor);
  if organization.id is null or not organization.active or not coalesce(platform or actor_role in ('owner','admin'), false)
    then raise exception 'Workspace management unavailable'; end if;
  if access_role is null or access_role not in ('admin','supervisor','investigator','member','revoke')
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

-- ---------------------------------------------------------------------------
-- 2. Organisation feature entitlements (configured by platform administrators)
-- ---------------------------------------------------------------------------
create table public.lv_workspace_features (
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  feature text not null check (feature in ('people_analytics','vehicle_analytics','advanced_detection','anpr','vehicle_registry','security_intelligence','business_intelligence')),
  enabled boolean not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature)
);
alter table public.lv_workspace_features enable row level security;
revoke all on public.lv_workspace_features from public,anon,authenticated;

create function public.lv_feature_enabled(target uuid, feature_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(
    (select f.enabled from public.lv_workspace_features f where f.workspace_id=target and f.feature=feature_name),
    (select case w.kind
        when 'agency' then feature_name <> 'business_intelligence'
        when 'business' then feature_name in ('people_analytics','vehicle_analytics','advanced_detection','business_intelligence')
        else false end
     from public.lv_workspaces w where w.id=target),
    false)
$$;
revoke all on function public.lv_feature_enabled(uuid,text) from public,anon,authenticated;
grant execute on function public.lv_feature_enabled(uuid,text) to authenticated;

create function public.lv_workspace_feature_map(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f text; result jsonb := '{}'::jsonb;
begin
  if not (public.lv_workspace_active(target) or exists(select 1 from public.lv_platform_admins a where a.user_id=auth.uid())) then
    raise exception 'Workspace unavailable';
  end if;
  foreach f in array array['people_analytics','vehicle_analytics','advanced_detection','anpr','vehicle_registry','security_intelligence','business_intelligence'] loop
    result := result || jsonb_build_object(f, public.lv_feature_enabled(target, f));
  end loop;
  return result;
end $$;
revoke all on function public.lv_workspace_feature_map(uuid) from public,anon,authenticated;
grant execute on function public.lv_workspace_feature_map(uuid) to authenticated;

create function public.lv_set_workspace_feature(target uuid, feature_name text, is_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid()) then raise exception 'Platform administrator required'; end if;
  if not exists(select 1 from public.lv_workspaces where id=target) then raise exception 'Workspace unavailable'; end if;
  insert into public.lv_workspace_features(workspace_id,feature,enabled,updated_by) values(target,feature_name,is_enabled,auth.uid())
  on conflict(workspace_id,feature) do update set enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=now();
  insert into public.lv_workspace_activity(workspace_id,actor_id,action)
    values(target,auth.uid(),'feature.'||feature_name||case when is_enabled then '.enabled' else '.disabled' end);
end $$;
revoke all on function public.lv_set_workspace_feature(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.lv_set_workspace_feature(uuid,text,boolean) to authenticated;

create function public.lv_platform_organizations()
returns table(id uuid, name text, kind text, active boolean, features jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.lv_platform_admins where user_id=auth.uid()) then
    raise exception 'Platform administrator required';
  end if;
  return query
    select w.id, w.name, w.kind, w.active, public.lv_workspace_feature_map(w.id)
    from public.lv_workspaces w
    order by w.kind, w.name;
end $$;
revoke all on function public.lv_platform_organizations() from public,anon,authenticated;
grant execute on function public.lv_platform_organizations() to authenticated;

do $$
begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename='lv_workspace_activity' and policyname='lv_workspace_activity_read') then
    alter policy lv_workspace_activity_read on public.lv_workspace_activity using (
      exists(select 1 from public.lv_memberships m where m.workspace_id=lv_workspace_activity.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin'))
      or exists(select 1 from public.lv_platform_admins a join public.lv_workspaces w on w.id=lv_workspace_activity.workspace_id
                where a.user_id=(select auth.uid()) and w.kind='agency')
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-camera intelligence settings
-- ---------------------------------------------------------------------------
create table public.lv_camera_intel_settings (
  camera_id uuid primary key references public.lv_cameras on delete cascade,
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index lv_camera_intel_settings_workspace on public.lv_camera_intel_settings(workspace_id);
alter table public.lv_camera_intel_settings enable row level security;
revoke all on public.lv_camera_intel_settings from public,anon,authenticated;
grant select on public.lv_camera_intel_settings to authenticated;
create policy lv_camera_intel_settings_read on public.lv_camera_intel_settings for select to authenticated
  using (public.lv_workspace_active(workspace_id));

create function public.lv_validate_intel_settings(target uuid, s jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare cap record; item record; zone jsonb; pt jsonb; feature text; ids text[] := '{}'; zid text; n integer; day jsonb; cat jsonb;
begin
  if s is null or jsonb_typeof(s) is distinct from 'object' or length(s::text) > 60000 then raise exception 'Invalid camera settings'; end if;

  if s->'capabilities' is not null then
    if jsonb_typeof(s->'capabilities') is distinct from 'object' then raise exception 'Invalid capabilities'; end if;
    for cap in select key, value from jsonb_each(s->'capabilities') loop
      feature := case cap.key
        when 'people_detection' then 'people_analytics' when 'people_counting' then 'people_analytics'
        when 'occupancy' then 'people_analytics' when 'crowd' then 'people_analytics'
        when 'vehicle_detection' then 'vehicle_analytics' when 'vehicle_counting' then 'vehicle_analytics'
        when 'vehicle_stationary' then 'vehicle_analytics'
        when 'loitering' then 'advanced_detection' when 'intrusion' then 'advanced_detection'
        when 'perimeter' then 'advanced_detection' when 'abandoned_object' then 'advanced_detection'
        when 'tamper' then 'advanced_detection' when 'camera_health' then 'advanced_detection'
        when 'anpr' then 'anpr'
        else null end;
      if feature is null then raise exception 'Unsupported capability: %', cap.key; end if;
      if jsonb_typeof(cap.value) is distinct from 'object' or jsonb_typeof(cap.value->'enabled') is distinct from 'boolean' then
        raise exception 'Invalid capability: %', cap.key; end if;
      if (cap.value->>'enabled')::boolean and not public.lv_feature_enabled(target, feature) then
        raise exception 'Capability % is not enabled for this organization', cap.key; end if;
      if cap.value->'sensitivity' is not null and (cap.value->>'sensitivity') not in ('low','medium','high') then
        raise exception 'Invalid sensitivity for %', cap.key; end if;
    end loop;
  end if;

  if s->'zones' is not null then
    if jsonb_typeof(s->'zones') is distinct from 'array' or jsonb_array_length(s->'zones') > 20 then raise exception 'Invalid zones'; end if;
    for zone in select value from jsonb_array_elements(s->'zones') loop
      zid := zone->>'id';
      if zid is null or zid !~ '^[A-Za-z0-9_-]{1,40}$' or zid = any(ids) then raise exception 'Invalid zone identifier'; end if;
      ids := ids || zid;
      if coalesce(length(btrim(zone->>'name')),0) not between 1 and 60 then raise exception 'Zone names must be 1 to 60 characters'; end if;
      if zone->>'kind' is null or zone->>'kind' not in ('count_line','area','restricted','perimeter','parking') then raise exception 'Invalid zone type'; end if;
      if jsonb_typeof(zone->'points') is distinct from 'array' then raise exception 'Invalid zone points'; end if;
      n := jsonb_array_length(zone->'points');
      if (zone->>'kind'='count_line' and n<>2) or (zone->>'kind'<>'count_line' and (n<3 or n>32)) then raise exception 'Invalid zone point count'; end if;
      for pt in select value from jsonb_array_elements(zone->'points') loop
        if jsonb_typeof(pt) is distinct from 'array' or jsonb_array_length(pt)<>2
          or jsonb_typeof(pt->0) is distinct from 'number' or jsonb_typeof(pt->1) is distinct from 'number'
          or (pt->>0)::numeric not between 0 and 1 or (pt->>1)::numeric not between 0 and 1 then
          raise exception 'Zone points must be inside the camera frame'; end if;
      end loop;
    end loop;
  end if;

  if s->'thresholds' is not null then
    if jsonb_typeof(s->'thresholds') is distinct from 'object' then raise exception 'Invalid thresholds'; end if;
    for item in select key, value from jsonb_each(s->'thresholds') loop
      if jsonb_typeof(item.value) is distinct from 'number' then raise exception 'Threshold % must be a number', item.key; end if;
      if not (case item.key
        when 'crowd_max' then (item.value#>>'{}')::numeric between 1 and 1000
        when 'occupancy_max' then (item.value#>>'{}')::numeric between 1 and 10000
        when 'loiter_seconds' then (item.value#>>'{}')::numeric between 5 and 86400
        when 'stationary_seconds' then (item.value#>>'{}')::numeric between 30 and 86400
        when 'abandoned_seconds' then (item.value#>>'{}')::numeric between 15 and 86400
        when 'alert_cooldown_seconds' then (item.value#>>'{}')::numeric between 15 and 3600
        else false end) then
        raise exception 'Threshold % is not valid', item.key; end if;
    end loop;
  end if;

  if s->'schedule' is not null then
    if jsonb_typeof(s->'schedule') is distinct from 'object' or jsonb_typeof(s->'schedule'->'enabled') is distinct from 'boolean' then raise exception 'Invalid schedule'; end if;
    if jsonb_typeof(s->'schedule'->'days') is distinct from 'array' or jsonb_array_length(s->'schedule'->'days') > 7 then raise exception 'Invalid schedule days'; end if;
    for day in select value from jsonb_array_elements(s->'schedule'->'days') loop
      if jsonb_typeof(day) is distinct from 'number' or (day#>>'{}')::numeric not between 0 and 6 then raise exception 'Invalid schedule day'; end if;
    end loop;
    if coalesce(s->'schedule'->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(s->'schedule'->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Schedule times must use HH:MM'; end if;
  end if;

  if s->'notify' is not null then
    if jsonb_typeof(s->'notify') is distinct from 'object' then raise exception 'Invalid notification settings'; end if;
    if s->'notify'->'categories' is not null then
      if jsonb_typeof(s->'notify'->'categories') is distinct from 'array' then raise exception 'Invalid notification categories'; end if;
      for cat in select value from jsonb_array_elements(s->'notify'->'categories') loop
        if jsonb_typeof(cat) is distinct from 'string' or (cat#>>'{}') not in ('crowd','loitering','intrusion','perimeter_breach','stationary_vehicle','abandoned_object','tamper','camera_offline','watchlist_match') then
          raise exception 'Invalid notification category'; end if;
      end loop;
    end if;
  end if;
end $$;
revoke all on function public.lv_validate_intel_settings(uuid,jsonb) from public,anon,authenticated;

create function public.lv_save_camera_intel(target uuid, camera uuid, expected_revision bigint, new_settings jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare current_row public.lv_camera_intel_settings; next_revision bigint;
begin
  if not public.lv_workspace_permission(target,'configure') then raise exception 'Camera configuration unavailable'; end if;
  if not exists(select 1 from public.lv_cameras c where c.id=camera and c.workspace_id=target) then raise exception 'Camera unavailable'; end if;
  perform public.lv_validate_intel_settings(target,new_settings);
  select * into current_row from public.lv_camera_intel_settings where camera_id=camera for update;
  if current_row.camera_id is null then
    if coalesce(expected_revision,0)<>0 then raise exception 'Settings changed. Refresh before saving.'; end if;
    insert into public.lv_camera_intel_settings(camera_id,workspace_id,settings,revision,updated_by) values(camera,target,new_settings,1,auth.uid());
    next_revision := 1;
  else
    if expected_revision is distinct from current_row.revision then raise exception 'Settings changed. Refresh before saving.'; end if;
    update public.lv_camera_intel_settings set settings=new_settings, revision=revision+1, updated_by=auth.uid(), updated_at=now()
      where camera_id=camera returning revision into next_revision;
  end if;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(target,auth.uid(),camera,'camera.intelligence_configured');
  return next_revision;
end $$;
revoke all on function public.lv_save_camera_intel(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.lv_save_camera_intel(uuid,uuid,bigint,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Structured analytics events
-- ---------------------------------------------------------------------------
create table public.lv_intel_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  camera_id uuid references public.lv_cameras on delete set null,
  category text not null check (category in ('census','line_crossing','occupancy','crowd','loitering','intrusion','perimeter_breach','stationary_vehicle','abandoned_object','tamper','camera_offline','plate_read','watchlist_match')),
  object_class text check (object_class is null or object_class ~ '^[a-z][a-z ]{1,29}$'),
  direction text check (direction is null or direction in ('in','out')),
  event_count integer not null default 1 check (event_count between 0 and 100000),
  zone_id text check (zone_id is null or length(zone_id) <= 40),
  plate text check (plate is null or plate ~ '^[A-Z0-9]{2,12}$'),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and length(payload::text) <= 4000),
  snapshot_path text check (snapshot_path is null or length(snapshot_path) <= 300),
  source text not null check (source in ('camera','file')),
  occurred_at timestamptz not null,
  request_id uuid not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index lv_intel_events_request on public.lv_intel_events(workspace_id, created_by, request_id);
create index lv_intel_events_recent on public.lv_intel_events(workspace_id, occurred_at desc);
create index lv_intel_events_camera on public.lv_intel_events(workspace_id, camera_id, occurred_at desc);
create index lv_intel_events_category on public.lv_intel_events(workspace_id, category, occurred_at desc);
create index lv_intel_events_plate on public.lv_intel_events(workspace_id, plate, occurred_at desc) where plate is not null;
alter table public.lv_intel_events enable row level security;
revoke all on public.lv_intel_events from public,anon,authenticated;
grant select on public.lv_intel_events to authenticated;
-- Number plate activity is a security record: ordinary business workspaces never see it.
create policy lv_intel_events_read on public.lv_intel_events for select to authenticated using (
  public.lv_workspace_active(workspace_id)
  and (category not in ('plate_read','watchlist_match') or public.lv_agency_member(workspace_id))
);

-- ---------------------------------------------------------------------------
-- 5. Alerts: extend the existing queue so business and agency use one system
-- ---------------------------------------------------------------------------
alter table public.lv_agency_alerts
  add column camera_id uuid references public.lv_cameras on delete set null,
  add column event_id uuid references public.lv_intel_events on delete set null,
  add column category text,
  add column recommended_action text not null default '' check (length(recommended_action) <= 500),
  add column snapshot_path text check (snapshot_path is null or length(snapshot_path) <= 300),
  add column dedupe_key text,
  add column acknowledged_by uuid,
  add column acknowledged_at timestamptz;
create index lv_alerts_workspace_status on public.lv_agency_alerts(workspace_id, status, created_at desc);
create index lv_alerts_camera on public.lv_agency_alerts(camera_id, category, created_at desc);

alter policy lv_alerts_read on public.lv_agency_alerts using (
  public.lv_workspace_active(workspace_id)
  and (category is distinct from 'watchlist_match' or public.lv_agency_member(workspace_id))
);
alter policy lv_alerts_insert on public.lv_agency_alerts with check (
  public.lv_workspace_active(workspace_id)
  and (category is distinct from 'watchlist_match' or public.lv_agency_member(workspace_id))
);

create or replace function public.lv_transition_alert(target uuid, expected text, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_alerts;
begin
  select * into item from public.lv_agency_alerts where id=target for update;
  if item.id is null or not public.lv_workspace_active(item.workspace_id)
    or (item.category is not distinct from 'watchlist_match' and not public.lv_agency_member(item.workspace_id)) then
    raise exception 'Alert unavailable'; end if;
  if item.status<>expected then raise exception 'Alert changed. Refresh and retry.'; end if;
  if next_status is null or not ((expected='open' and next_status='acknowledged')
    or (expected='acknowledged' and next_status='resolved') or (expected='resolved' and next_status='open'))
    then raise exception 'Invalid alert transition'; end if;
  if not public.lv_workspace_permission(item.workspace_id, case when next_status='acknowledged' then 'alert_ack' else 'alert_resolve' end) then
    raise exception 'Your role cannot make this change'; end if;
  update public.lv_agency_alerts set status=next_status, updated_at=now(),
    acknowledged_by=case when next_status='acknowledged' then auth.uid() else acknowledged_by end,
    acknowledged_at=case when next_status='acknowledged' then now() else acknowledged_at end
    where id=target;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
    values(item.workspace_id,auth.uid(),target,'alert.'||next_status);
end $$;

create function public.lv_alert_summary(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'open', count(*) filter (where status='open'),
    'high', count(*) filter (where status='open' and severity='high'))
  from public.lv_agency_alerts where workspace_id=target
$$;
grant execute on function public.lv_alert_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Vehicle watchlist: categories, vehicle details, lifecycle, permissions
-- ---------------------------------------------------------------------------
alter table public.lv_vehicle_watchlist drop constraint if exists lv_vehicle_watchlist_reason_check;
alter table public.lv_vehicle_watchlist add constraint lv_vehicle_watchlist_reason_check
  check (reason in ('stolen','wanted','interest','authorized','other','watchlist'));
alter table public.lv_vehicle_watchlist
  add column make text not null default '' check (length(make) <= 60),
  add column model text not null default '' check (length(model) <= 60),
  add column colour text not null default '' check (length(colour) <= 60),
  add column photo_path text check (photo_path is null or length(photo_path) <= 300),
  add column description text not null default '' check (length(description) <= 2000),
  add column notes text not null default '' check (length(notes) <= 4000),
  add column status text not null default 'active' check (status in ('active','inactive','resolved')),
  add column custom_category text not null default '' check (length(custom_category) <= 60),
  add column revision bigint not null default 1,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid,
  add column created_by_label text not null default '',
  add column updated_by_label text not null default '';
grant insert(make,model,colour,photo_path,description,notes,status,custom_category) on public.lv_vehicle_watchlist to authenticated;

alter policy lv_vehicle_watchlist_read on public.lv_vehicle_watchlist using (public.lv_agency_member(workspace_id));
alter policy lv_vehicle_watchlist_add on public.lv_vehicle_watchlist with check (
  public.lv_workspace_permission(workspace_id,'watchlist_write')
  and public.lv_agency_member(workspace_id)
  and public.lv_feature_enabled(workspace_id,'anpr')
);

create function public.lv_watchlist_defaults() returns trigger
language plpgsql security definer set search_path='' as $$
declare claims jsonb;
begin
  begin claims := nullif(current_setting('request.jwt.claims', true),'')::jsonb; exception when others then claims := null; end;
  new.created_by_label := coalesce(nullif(claims->>'email',''), 'Personnel');
  return new;
end $$;
revoke all on function public.lv_watchlist_defaults() from public,anon,authenticated;
create trigger lv_watchlist_defaults before insert on public.lv_vehicle_watchlist for each row execute function public.lv_watchlist_defaults();
create trigger lv_watchlist_audit after insert on public.lv_vehicle_watchlist for each row execute function public.lv_agency_audit();

create function public.lv_update_vehicle_watch(target_id uuid, expected_revision bigint, new_reason text, new_case_reference text,
  new_make text, new_model text, new_colour text, new_photo_path text, new_description text, new_notes text,
  new_status text, new_custom_category text) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_vehicle_watchlist; claims jsonb;
begin
  select * into item from public.lv_vehicle_watchlist where id=target_id for update;
  if item.id is null or item.retired_at is not null or not public.lv_agency_member(item.workspace_id)
    or not public.lv_workspace_permission(item.workspace_id,'watchlist_write') then raise exception 'Watchlist entry unavailable'; end if;
  if expected_revision is distinct from item.revision then raise exception 'Entry changed. Refresh before editing.'; end if;
  if new_photo_path is not null and (new_photo_path not like item.workspace_id::text || '/%' or new_photo_path like '%..%') then raise exception 'Invalid photo path'; end if;
  begin claims := nullif(current_setting('request.jwt.claims', true),'')::jsonb; exception when others then claims := null; end;
  update public.lv_vehicle_watchlist set reason=new_reason, case_reference=btrim(new_case_reference), make=btrim(new_make), model=btrim(new_model),
    colour=btrim(new_colour), photo_path=new_photo_path, description=btrim(new_description), notes=btrim(new_notes), status=new_status,
    custom_category=btrim(new_custom_category), revision=revision+1, updated_at=now(), updated_by=auth.uid(),
    updated_by_label=coalesce(nullif(claims->>'email',''),'Personnel')
    where id=target_id;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(item.workspace_id,auth.uid(),target_id,'vehicle_watch.updated');
end $$;
revoke all on function public.lv_update_vehicle_watch(uuid,bigint,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.lv_update_vehicle_watch(uuid,bigint,text,text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.lv_retire_vehicle_watch(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_vehicle_watchlist;
begin
  select * into item from public.lv_vehicle_watchlist where id=target_id for update;
  if item.id is null or item.retired_at is not null or not public.lv_agency_member(item.workspace_id)
    or not public.lv_workspace_permission(item.workspace_id,'watchlist_archive') then raise exception 'Active watchlist entry unavailable'; end if;
  update public.lv_vehicle_watchlist set retired_at=now(), retired_by=auth.uid(), updated_at=now(), updated_by=auth.uid(), revision=revision+1 where id=target_id;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(item.workspace_id,auth.uid(),target_id,'vehicle_watch.archived');
end $$;

create function public.lv_delete_vehicle_watch(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_vehicle_watchlist;
begin
  select * into item from public.lv_vehicle_watchlist where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id)
    or not public.lv_workspace_permission(item.workspace_id,'watchlist_delete') then raise exception 'Watchlist entry unavailable'; end if;
  delete from public.lv_vehicle_watchlist where id=target_id;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(item.workspace_id,auth.uid(),target_id,'vehicle_watch.deleted');
end $$;
revoke all on function public.lv_delete_vehicle_watch(uuid) from public,anon,authenticated;
grant execute on function public.lv_delete_vehicle_watch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Vehicle registration database (separate from the watchlist)
-- ---------------------------------------------------------------------------
create table public.lv_registry_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  source_name text not null check (length(btrim(source_name)) between 1 and 120),
  file_name text not null default '' check (length(file_name) <= 240),
  update_existing boolean not null default false,
  total_rows integer not null default 0,
  inserted_rows integer not null default 0,
  updated_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  invalid_rows integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index lv_registry_imports_recent on public.lv_registry_imports(workspace_id, created_at desc);

create table public.lv_vehicle_registry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  plate text not null check (plate collate "C" ~ '^[A-Z0-9]{2,12}$'),
  make text not null default '' check (length(make) <= 60),
  model text not null default '' check (length(model) <= 60),
  colour text not null default '' check (length(colour) <= 60),
  vehicle_type text not null default '' check (length(vehicle_type) <= 60),
  vehicle_year integer check (vehicle_year is null or vehicle_year between 1900 and 2100),
  registration_status text not null default 'unknown' check (registration_status in ('registered','expired','unregistered','unknown')),
  notes text not null default '' check (length(notes) <= 1000),
  source_name text not null default 'manual',
  import_id uuid references public.lv_registry_imports on delete set null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, plate)
);
create index lv_vehicle_registry_search on public.lv_vehicle_registry(workspace_id, plate varchar_pattern_ops);
alter table public.lv_registry_imports enable row level security;
alter table public.lv_vehicle_registry enable row level security;
revoke all on public.lv_registry_imports, public.lv_vehicle_registry from public,anon,authenticated;
grant select on public.lv_registry_imports, public.lv_vehicle_registry to authenticated;
create policy lv_registry_read on public.lv_vehicle_registry for select to authenticated
  using (public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id,'vehicle_registry'));
create policy lv_registry_imports_read on public.lv_registry_imports for select to authenticated
  using (public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id,'vehicle_registry'));

create function public.lv_registry_apply_row(target uuid, r jsonb, update_existing boolean, import_ref uuid, source text) returns text
language plpgsql security definer set search_path='' as $$
declare p text := public.lv_normalize_plate(r->>'plate'); y integer; st text; existing public.lv_vehicle_registry;
begin
  if p !~ '^[A-Z0-9]{2,12}$' then return 'invalid:Plate must be 2 to 12 letters or digits'; end if;
  begin y := nullif(btrim(r->>'year'),'')::integer; exception when others then return 'invalid:Year is not a number'; end;
  if y is not null and y not between 1900 and 2100 then return 'invalid:Year is out of range'; end if;
  st := lower(coalesce(nullif(btrim(r->>'registration_status'),''),'unknown'));
  if st not in ('registered','expired','unregistered','unknown') then return 'invalid:Unknown registration status'; end if;
  if length(coalesce(r->>'make',''))>60 or length(coalesce(r->>'model',''))>60 or length(coalesce(r->>'colour',''))>60
    or length(coalesce(r->>'vehicle_type',''))>60 or length(coalesce(r->>'notes',''))>1000 then return 'invalid:A field is too long'; end if;
  select * into existing from public.lv_vehicle_registry where workspace_id=target and plate=p;
  if existing.id is null then
    insert into public.lv_vehicle_registry(workspace_id,plate,make,model,colour,vehicle_type,vehicle_year,registration_status,notes,source_name,import_id,created_by)
    values(target,p,btrim(coalesce(r->>'make','')),btrim(coalesce(r->>'model','')),btrim(coalesce(r->>'colour','')),btrim(coalesce(r->>'vehicle_type','')),y,st,btrim(coalesce(r->>'notes','')),source,import_ref,auth.uid());
    return 'inserted';
  elsif update_existing then
    update public.lv_vehicle_registry set
      make=coalesce(nullif(btrim(r->>'make'),''),make), model=coalesce(nullif(btrim(r->>'model'),''),model),
      colour=coalesce(nullif(btrim(r->>'colour'),''),colour), vehicle_type=coalesce(nullif(btrim(r->>'vehicle_type'),''),vehicle_type),
      vehicle_year=coalesce(y,vehicle_year), registration_status=case when nullif(btrim(r->>'registration_status'),'') is null then registration_status else st end,
      notes=coalesce(nullif(btrim(r->>'notes'),''),notes), source_name=source, import_id=coalesce(import_ref,import_id), updated_at=now()
      where id=existing.id;
    return 'updated';
  end if;
  return 'duplicate';
end $$;
revoke all on function public.lv_registry_apply_row(uuid,jsonb,boolean,uuid,text) from public,anon,authenticated;

create function public.lv_import_registry(target uuid, source_name text, file_name text, entries jsonb, update_existing boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; ord integer := 0; res text; import_ref uuid := gen_random_uuid(); ins integer := 0; upd integer := 0; dup integer := 0; bad integer := 0;
  errs jsonb := '[]'::jsonb; seen text[] := '{}'; p text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target,'registry_write')
    or not public.lv_feature_enabled(target,'vehicle_registry') then raise exception 'Registry import unavailable'; end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 2000 then raise exception 'Import between 1 and 2000 rows per file'; end if;
  if length(btrim(coalesce(source_name,''))) not between 1 and 120 then raise exception 'Name the data source'; end if;
  insert into public.lv_registry_imports(id,workspace_id,source_name,file_name,update_existing,total_rows)
    values(import_ref,target,btrim(source_name),left(coalesce(file_name,''),240),coalesce(update_existing,false),jsonb_array_length(entries));
  for r in select value from jsonb_array_elements(entries) loop
    ord := ord + 1;
    p := public.lv_normalize_plate(r->>'plate');
    if p ~ '^[A-Z0-9]{2,12}$' and p = any(seen) then
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Duplicate plate within this file')); end if;
      continue;
    end if;
    if p ~ '^[A-Z0-9]{2,12}$' then seen := seen || p; end if;
    res := public.lv_registry_apply_row(target, r, coalesce(update_existing,false), import_ref, btrim(source_name));
    if res='inserted' then ins := ins + 1;
    elsif res='updated' then upd := upd + 1;
    elsif res='duplicate' then
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Already in the registry')); end if;
    else
      bad := bad + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',coalesce(r->>'plate',''),'error',substr(res,9))); end if;
    end if;
  end loop;
  update public.lv_registry_imports set inserted_rows=ins, updated_rows=upd, duplicate_rows=dup, invalid_rows=bad, errors=errs where id=import_ref;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(target,auth.uid(),import_ref,'registry.imported');
  return jsonb_build_object('import_id',import_ref,'total',ord,'inserted',ins,'updated',upd,'duplicates',dup,'invalid',bad,'errors',errs);
end $$;
revoke all on function public.lv_import_registry(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.lv_import_registry(uuid,text,text,jsonb,boolean) to authenticated;

create function public.lv_save_registry_vehicle(target uuid, vehicle jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare res text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target,'registry_write')
    or not public.lv_feature_enabled(target,'vehicle_registry') then raise exception 'Registry changes unavailable'; end if;
  res := public.lv_registry_apply_row(target, vehicle, true, null, 'manual');
  if res like 'invalid:%' then raise exception '%', substr(res,9); end if;
  insert into public.lv_workspace_activity(workspace_id,actor_id,action) values(target,auth.uid(),'registry.vehicle_saved');
  return res;
end $$;
revoke all on function public.lv_save_registry_vehicle(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lv_save_registry_vehicle(uuid,jsonb) to authenticated;

create function public.lv_delete_registry_vehicle(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_vehicle_registry;
begin
  select * into item from public.lv_vehicle_registry where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id,'registry_write') then
    raise exception 'Registry record unavailable'; end if;
  delete from public.lv_vehicle_registry where id=target_id;
  insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(item.workspace_id,auth.uid(),target_id,'registry.vehicle_deleted');
end $$;
revoke all on function public.lv_delete_registry_vehicle(uuid) from public,anon,authenticated;
grant execute on function public.lv_delete_registry_vehicle(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Event ingestion, plate matching and alert generation
-- ---------------------------------------------------------------------------
create function public.lv_raise_intel_alert(target uuid, evt public.lv_intel_events, alert_name text, alert_details text,
  alert_level text, next_step text, dedupe text, cooldown integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if exists(select 1 from public.lv_agency_alerts a where a.workspace_id=target and a.camera_id is not distinct from evt.camera_id
    and a.category=evt.category and a.dedupe_key is not distinct from dedupe
    and a.created_at > clock_timestamp() - make_interval(secs => cooldown)) then return null; end if;
  insert into public.lv_agency_alerts(workspace_id,title,details,severity,camera_id,event_id,category,recommended_action,snapshot_path,dedupe_key,created_by)
  values(target,left(alert_name,140),left(alert_details,4000),alert_level,evt.camera_id,evt.id,evt.category,left(next_step,500),evt.snapshot_path,dedupe,auth.uid())
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.lv_raise_intel_alert(uuid,public.lv_intel_events,text,text,text,text,text,integer) from public,anon,authenticated;

create function public.lv_record_intel_events(target uuid, events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ev jsonb; cat text; cls text; feat text; cam uuid; cam_name text; evt public.lv_intel_events; mevt public.lv_intel_events;
  wl public.lv_vehicle_watchlist; reg public.lv_vehicle_registry; plate_value text; payload_value jsonb; snap text; occurred timestamptz;
  cfg jsonb; notify_ok boolean; cooldown integer; saved_n integer := 0; dup_n integer := 0; alert_n integer := 0;
  matches jsonb := '[]'::jsonb; alert_ref uuid; alert_level text; alert_name text; next_step text; wl_label text; src text;
begin
  if not public.lv_workspace_active(target) then raise exception 'Analytics storage unavailable'; end if;
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events) not between 1 and 50 then raise exception 'Invalid event batch'; end if;

  for ev in select value from jsonb_array_elements(events) loop
    cat := ev->>'category';
    cls := nullif(btrim(ev->>'object_class'),'');
    cam := nullif(ev->>'camera','')::uuid;
    if cat is null or cat not in ('census','line_crossing','occupancy','crowd','loitering','intrusion','perimeter_breach','stationary_vehicle','abandoned_object','tamper','camera_offline','plate_read') then
      raise exception 'Invalid event category'; end if;
    feat := case
      when cat in ('census','line_crossing','occupancy','crowd') then
        case when cls='person' then 'people_analytics' when cls in ('car','motorcycle','bus','truck','bicycle','vehicle') then 'vehicle_analytics' else null end
      when cat='stationary_vehicle' then 'vehicle_analytics'
      when cat in ('loitering','intrusion','perimeter_breach','abandoned_object','tamper','camera_offline') then 'advanced_detection'
      when cat='plate_read' then 'anpr' end;
    if feat is null or not public.lv_feature_enabled(target, feat) then raise exception 'This analytics feature is not enabled for the organization'; end if;
    if cam is not null and not exists(select 1 from public.lv_cameras c where c.id=cam and c.workspace_id=target) then raise exception 'Camera unavailable'; end if;
    src := coalesce(nullif(ev->>'source',''), case when cam is null then 'file' else 'camera' end);
    if src not in ('camera','file') or (src='camera' and cam is null) then raise exception 'Invalid event source'; end if;
    occurred := (ev->>'occurred_at')::timestamptz;
    if occurred is null or occurred < now() - interval '24 hours' or occurred > now() + interval '5 minutes' then raise exception 'Event time is outside the accepted window'; end if;
    payload_value := coalesce(ev->'payload','{}'::jsonb);
    if jsonb_typeof(payload_value) is distinct from 'object' or length(payload_value::text) > 4000 then raise exception 'Invalid event payload'; end if;
    snap := nullif(ev->>'snapshot_path','');
    if snap is not null and (snap not like target::text || '/%' or length(snap) > 300 or snap like '%..%') then raise exception 'Invalid snapshot path'; end if;
    plate_value := nullif(public.lv_normalize_plate(ev->>'plate'),'');
    if cat='plate_read' and (plate_value is null or plate_value !~ '^[A-Z0-9]{2,12}$') then raise exception 'Invalid plate'; end if;
    if cat<>'plate_read' then plate_value := null; end if;

    insert into public.lv_intel_events(workspace_id,camera_id,category,object_class,direction,event_count,zone_id,plate,confidence,payload,snapshot_path,source,occurred_at,request_id,created_by)
    values(target,cam,cat,cls,nullif(ev->>'direction',''),coalesce((ev->>'count')::integer,1),left(nullif(ev->>'zone',''),40),plate_value,
      nullif(ev->>'confidence','')::numeric,payload_value,snap,src,occurred,(ev->>'request_id')::uuid,auth.uid())
    on conflict(workspace_id,created_by,request_id) do nothing
    returning * into evt;

    if evt.id is null then dup_n := dup_n + 1; continue; end if;
    saved_n := saved_n + 1;

    select s.settings into cfg from public.lv_camera_intel_settings s where s.camera_id=cam;
    notify_ok := cfg is null or cfg->'notify'->'categories' is null or (cfg->'notify'->'categories') @> to_jsonb(cat);
    cooldown := coalesce((cfg->'thresholds'->>'alert_cooldown_seconds')::integer, 60);
    select c.name into cam_name from public.lv_cameras c where c.id=cam;

    if cat='plate_read' then
      if public.lv_agency_member(target) and public.lv_feature_enabled(target,'vehicle_registry') then
        select * into reg from public.lv_vehicle_registry r where r.workspace_id=target and r.plate=plate_value;
        if reg.id is not null then
          update public.lv_intel_events set payload = payload || jsonb_build_object('registry', jsonb_build_object(
            'id',reg.id,'make',reg.make,'model',reg.model,'colour',reg.colour,'registration_status',reg.registration_status)) where id=evt.id;
        end if;
      end if;
      select * into wl from public.lv_vehicle_watchlist w
        where w.workspace_id=target and w.plate=plate_value and w.retired_at is null and w.status='active';
      if wl.id is not null and public.lv_agency_member(target) then
        wl_label := case wl.reason when 'stolen' then 'Stolen vehicle' when 'wanted' then 'Wanted vehicle' when 'interest' then 'Vehicle of interest'
          when 'authorized' then 'Authorized vehicle' when 'other' then coalesce(nullif(wl.custom_category,''),'Watchlist vehicle') else 'Watchlist vehicle' end;
        insert into public.lv_intel_events(workspace_id,camera_id,category,object_class,event_count,zone_id,plate,confidence,payload,snapshot_path,source,occurred_at,request_id,created_by)
        values(target,cam,'watchlist_match',cls,1,evt.zone_id,plate_value,evt.confidence,
          jsonb_build_object('watchlist_id',wl.id,'watchlist_category',wl.reason,'label',wl_label,'reference',wl.case_reference,'source_event_id',evt.id,
            'make',wl.make,'model',wl.model,'colour',wl.colour),snap,src,occurred,gen_random_uuid(),auth.uid())
        returning * into mevt;
        alert_ref := null;
        if wl.reason <> 'authorized' and (cfg is null or cfg->'notify'->'categories' is null or (cfg->'notify'->'categories') @> to_jsonb('watchlist_match'::text)) then
          alert_level := case when wl.reason in ('stolen','wanted') then 'high' else 'medium' end;
          next_step := case wl.reason
            when 'stolen' then 'Verify the plate against the vehicle in the snapshot, then notify the responding unit and follow the stolen-vehicle procedure.'
            when 'wanted' then 'Confirm the plate and vehicle description, then notify the investigating officer before any contact.'
            else 'Review the snapshot and the watchlist record, then log any follow-up against the reference.' end;
          alert_ref := public.lv_raise_intel_alert(target, mevt, 'Watchlist match: '||plate_value||' ('||wl_label||')',
            'Plate '||plate_value||' matched watchlist reference '||wl.case_reference||' on '||coalesce(cam_name,'uploaded footage')||'.', alert_level, next_step, plate_value, cooldown);
          if alert_ref is not null then alert_n := alert_n + 1; end if;
        end if;
        matches := matches || jsonb_build_array(jsonb_build_object('event_id',mevt.id,'plate',plate_value,'watchlist_id',wl.id,
          'category',wl.reason,'label',wl_label,'reference',wl.case_reference,'camera',cam,'alert_id',alert_ref));
      end if;

    elsif cat in ('crowd','loitering','intrusion','perimeter_breach','stationary_vehicle','abandoned_object','tamper','camera_offline') and notify_ok then
      alert_name := case cat when 'crowd' then 'Crowd threshold exceeded' when 'loitering' then 'Loitering detected'
        when 'intrusion' then 'Restricted-area intrusion' when 'perimeter_breach' then 'Perimeter breach'
        when 'stationary_vehicle' then 'Vehicle stationary beyond limit' when 'abandoned_object' then 'Unattended object detected'
        when 'tamper' then 'Camera tampering suspected' else 'Camera stream offline' end;
      alert_level := case when cat in ('intrusion','perimeter_breach','tamper') then 'high' else 'medium' end;
      next_step := case cat
        when 'crowd' then 'Review the snapshot and live view; deploy staff or restrict entry if the area is over capacity.'
        when 'loitering' then 'Review the footage and dispatch staff to check on the person if the behaviour is unexplained.'
        when 'intrusion' then 'Check the live feed immediately and dispatch the nearest responder if access is not authorised.'
        when 'perimeter_breach' then 'Check the live feed and confirm the breach before dispatching a patrol.'
        when 'stationary_vehicle' then 'Verify whether the vehicle is authorised to stop here; contact the owner or arrange removal.'
        when 'abandoned_object' then 'Do not touch the object. Review the footage and send staff to inspect following your unattended-item procedure.'
        when 'tamper' then 'Inspect the camera and its field of view on site; treat nearby activity as unmonitored until restored.'
        else 'Check the camera power, network and playback URL; confirm with the site team.' end;
      alert_ref := public.lv_raise_intel_alert(target, evt, alert_name,
        alert_name||' on '||coalesce(cam_name,'uploaded footage')||'. '||coalesce(payload_value->>'summary',''), alert_level, next_step, coalesce(evt.zone_id,''), cooldown);
      if alert_ref is not null then alert_n := alert_n + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('saved',saved_n,'duplicates',dup_n,'alerts',alert_n,'matches',matches);
end $$;
revoke all on function public.lv_record_intel_events(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lv_record_intel_events(uuid,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Reporting (invoker functions: row level security still applies)
-- ---------------------------------------------------------------------------
create function public.lv_intel_timeseries(target uuid, from_ts timestamptz, to_ts timestamptz, bucket text default 'hour', camera uuid default null)
returns table(bucket_start timestamptz, camera_id uuid, source text, category text, object_class text, direction text, events bigint, total_count bigint, avg_count numeric, max_count integer)
language plpgsql stable set search_path='' as $$
begin
  if bucket not in ('hour','day','week','month') then raise exception 'Invalid bucket'; end if;
  if to_ts - from_ts > interval '800 days' then raise exception 'Range too large'; end if;
  return query
    select date_trunc(bucket, e.occurred_at, 'Africa/Lagos'), e.camera_id, e.source, e.category, e.object_class, e.direction,
           count(*), sum(e.event_count)::bigint, avg(e.event_count), max(e.event_count)
    from public.lv_intel_events e
    where e.workspace_id=target and e.occurred_at >= from_ts and e.occurred_at < to_ts and (camera is null or e.camera_id=camera)
    group by 1,2,3,4,5,6 order by 1 limit 20000;
end $$;
grant execute on function public.lv_intel_timeseries(uuid,timestamptz,timestamptz,text,uuid) to authenticated;

create function public.lv_intel_camera_activity(target uuid)
returns table(camera_id uuid, last_event_at timestamptz, events_24h bigint)
language sql stable set search_path='' as $$
  select e.camera_id, max(e.occurred_at), count(*) filter (where e.occurred_at > now() - interval '24 hours')
  from public.lv_intel_events e where e.workspace_id=target and e.camera_id is not null and e.source='camera' group by e.camera_id
$$;
grant execute on function public.lv_intel_camera_activity(uuid) to authenticated;

create function public.lv_intel_current_occupancy(target uuid)
returns table(camera_id uuid, zone_id text, object_class text, current_count integer, observed_at timestamptz)
language sql stable set search_path='' as $$
  select distinct on (e.camera_id, e.zone_id, e.object_class) e.camera_id, e.zone_id, e.object_class, e.event_count, e.occurred_at
  from public.lv_intel_events e
  where e.workspace_id=target and e.category='occupancy' and e.source='camera' and e.occurred_at > now() - interval '10 minutes'
  order by e.camera_id, e.zone_id, e.object_class, e.occurred_at desc
$$;
grant execute on function public.lv_intel_current_occupancy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Private storage for event snapshots and vehicle photographs
-- ---------------------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-intel-snapshots','lv-intel-snapshots',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy lv_intel_snapshot_read on storage.objects for select to authenticated using (
  bucket_id='lv-intel-snapshots' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_workspace_active(w.id))
);
create policy lv_intel_snapshot_upload on storage.objects for insert to authenticated with check (
  bucket_id='lv-intel-snapshots' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_workspace_active(w.id))
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-vehicle-photos','lv-vehicle-photos',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy lv_vehicle_photo_read on storage.objects for select to authenticated using (
  bucket_id='lv-vehicle-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
create policy lv_vehicle_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id='lv-vehicle-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and public.lv_workspace_permission(w.id,'watchlist_write'))
);
create policy lv_vehicle_photo_cleanup on storage.objects for delete to authenticated using (
  bucket_id='lv-vehicle-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and public.lv_workspace_permission(w.id,'watchlist_write'))
);

commit;


-- ----------------------------------------------------------------------------
-- STEP 13/17: 202611120002_workspace_access.sql
-- ----------------------------------------------------------------------------
begin;
alter table public.lv_memberships drop constraint if exists lv_memberships_role_check;
alter table public.lv_memberships add constraint lv_memberships_role_check check(role in ('owner','admin','supervisor','investigator','member','viewer'));
alter table public.lv_memberships add column clearance integer not null default 3 check(clearance between 0 and 3),
 add column allowed_modules text[] not null default array['monitor','analytics','records','evidence','vehicles','access']
 check(allowed_modules <@ array['monitor','analytics','records','evidence','vehicles','access']::text[]);
alter table public.lv_cameras add column minimum_clearance integer not null default 0 check(minimum_clearance between 0 and 3),
 add column stream_type text not null default 'video' check(stream_type in ('video','hls','mjpeg'));
alter table public.lv_records add column minimum_clearance integer not null default 0 check(minimum_clearance between 0 and 3);
alter table public.lv_cameras drop constraint if exists lv_cameras_playback_url_check;
alter table public.lv_cameras add constraint lv_camera_playback_endpoint check(length(playback_url)<=2048 and playback_url ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/[^[:space:]#]*$');
grant insert(stream_type,minimum_clearance) on public.lv_cameras to authenticated;
grant insert(minimum_clearance) on public.lv_records to authenticated;

create function public.lv_has_scope(target uuid, module_name text, required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.lv_memberships m join public.lv_workspaces w on w.id=m.workspace_id
 where w.id=target and w.active and m.user_id=auth.uid() and m.clearance>=required_clearance
 and (m.role in ('owner','admin') or module_name=any(m.allowed_modules)))
$$;
revoke all on function public.lv_has_scope(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lv_has_scope(uuid,text,integer) to authenticated;

create function public.lv_set_staff_access(target uuid,email_address text,access_role text,access_clearance integer,modules text[]) returns void
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
 or not modules <@ array['monitor','analytics','records','evidence','vehicles','access']::text[]
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
revoke all on function public.lv_set_staff_access(uuid,text,text,integer,text[]) from public,anon,authenticated;
grant execute on function public.lv_set_staff_access(uuid,text,text,integer,text[]) to authenticated;

-- Legacy callers receive least-privilege defaults, never an implicit high clearance.
create or replace function public.lv_manage_workspace_access(target uuid,email_address text,access_role text) returns void
language plpgsql security definer set search_path='' as $$
begin perform public.lv_set_staff_access(target,email_address,access_role,0,array['monitor']); end $$;

create function public.lv_workspace_staff_access(target uuid) returns table(user_id uuid,email text,role text,clearance integer,allowed_modules text[])
language sql stable security definer set search_path='' as $$
 select m.user_id,u.email::text,m.role,m.clearance,m.allowed_modules from public.lv_memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=target and (public.lv_has_scope(target,'access') and exists(select 1 from public.lv_memberships a
 where a.workspace_id=target and a.user_id=auth.uid() and a.role in ('owner','admin'))
 or exists(select 1 from public.lv_platform_admins a join public.lv_workspaces w on w.id=target where a.user_id=auth.uid() and w.kind='agency'))
 order by u.email
$$;
revoke all on function public.lv_workspace_staff_access(uuid) from public,anon,authenticated;
grant execute on function public.lv_workspace_staff_access(uuid) to authenticated;

create or replace function public.lv_create_business(workspace_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null) then raise exception 'A confirmed account is required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select w.id into saved from public.lv_workspaces w join public.lv_memberships m on m.workspace_id=w.id
 where m.user_id=actor and w.kind='business' and m.role='owner' order by w.id limit 1;
 if saved is not null then return saved; end if;
 insert into public.lv_workspaces(name,kind) values(btrim(workspace_name),'business') returning id into saved;
 insert into public.lv_memberships(workspace_id,user_id,role,clearance) values(saved,actor,'owner',3);
 return saved;
end $$;

revoke all on function public.lv_create_business(text) from public,anon,authenticated;
grant execute on function public.lv_create_business(text) to authenticated;

-- Restrictive policies layer permissions onto existing tenant policies (including future permissive policies).
create policy lv_camera_clearance on public.lv_cameras as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'monitor',minimum_clearance)) with check(public.lv_has_scope(workspace_id,'monitor',minimum_clearance));
create policy lv_record_clearance on public.lv_records as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'records',minimum_clearance)) with check(public.lv_has_scope(workspace_id,'records',minimum_clearance));
create policy lv_observation_scope on public.lv_video_observations as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'analytics') and (camera_id is null or exists(select 1 from public.lv_cameras c where c.id=camera_id)))
 with check(public.lv_has_scope(workspace_id,'analytics') and (camera_id is null or exists(select 1 from public.lv_cameras c where c.id=camera_id)));
create function public.lv_can_read_alert(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.lv_has_scope(a.workspace_id,'monitor',coalesce(c.minimum_clearance,0))
 from public.lv_agency_alerts a left join public.lv_video_observations o on o.id=a.observation_id
 left join public.lv_cameras c on c.id=coalesce((to_jsonb(a)->>'camera_id')::uuid,o.camera_id)
 where a.id=target),false)
$$;
revoke all on function public.lv_can_read_alert(uuid) from public,anon,authenticated;
grant execute on function public.lv_can_read_alert(uuid) to authenticated;
create policy lv_alert_scope on public.lv_agency_alerts as restrictive for select to authenticated using(public.lv_can_read_alert(id));
create policy lv_evidence_scope on public.lv_agency_evidence as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'evidence') and exists(select 1 from public.lv_records r where r.id=record_id))
 with check(public.lv_has_scope(workspace_id,'evidence') and exists(select 1 from public.lv_records r where r.id=record_id));
create function public.lv_can_read_evidence_path(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.lv_agency_evidence e where e.storage_path=path) then exists(
 select 1 from public.lv_agency_evidence e join public.lv_records r on r.id=e.record_id and r.workspace_id=e.workspace_id
 where e.storage_path=path and public.lv_has_scope(e.workspace_id,'evidence',r.minimum_clearance)
 and public.lv_has_scope(e.workspace_id,'records',r.minimum_clearance))
 else split_part(path,'/',2)=auth.uid()::text and exists(select 1 from public.lv_workspaces w
 where w.id::text=split_part(path,'/',1) and public.lv_has_scope(w.id,'evidence')) end
$$;
revoke all on function public.lv_can_read_evidence_path(text) from public,anon,authenticated;
grant execute on function public.lv_can_read_evidence_path(text) to authenticated;
create policy lv_evidence_storage_scope on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'lv-agency-evidence' or public.lv_can_read_evidence_path(storage.objects.name))
 with check(bucket_id<>'lv-agency-evidence' or exists(select 1 from public.lv_workspaces w where w.id::text=split_part(storage.objects.name,'/',1) and public.lv_has_scope(w.id,'evidence')));

-- Definer RPCs also pass these guards; table RLS alone does not constrain definer functions.
create function public.lv_guard_resource_access() returns trigger language plpgsql security definer set search_path='' as $$
declare workspace uuid; required integer:=0; module_name text; resource jsonb;
begin
 if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
 resource:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; workspace:=(resource->>'workspace_id')::uuid;
 if exists(select 1 from public.lv_memberships m where m.workspace_id=workspace and m.user_id=auth.uid() and m.role='viewer')
 then raise exception 'View-only accounts cannot modify operational records'; end if;
 module_name:=case tg_table_name when 'lv_cameras' then 'monitor' when 'lv_records' then 'records'
 when 'lv_video_observations' then 'analytics' when 'lv_intel_events' then 'analytics' when 'lv_agency_evidence' then 'evidence'
 when 'lv_vehicle_watchlist' then 'vehicles' when 'lv_vehicle_registry' then 'vehicles' when 'lv_registry_imports' then 'vehicles' else 'monitor' end;
 required:=coalesce((resource->>'minimum_clearance')::integer,0);
 if tg_table_name='lv_agency_evidence' then
   select r.minimum_clearance into required from public.lv_records r where r.id=(resource->>'record_id')::uuid and r.workspace_id=workspace;
 elsif tg_table_name in ('lv_video_observations','lv_intel_events','lv_camera_intel_settings') and resource->>'camera_id' is not null then
   select c.minimum_clearance into required from public.lv_cameras c where c.id=(resource->>'camera_id')::uuid and c.workspace_id=workspace;
 elsif tg_table_name='lv_agency_alerts' and resource->>'observation_id' is not null then
   select coalesce(c.minimum_clearance,0) into required from public.lv_video_observations o
   left join public.lv_cameras c on c.id=o.camera_id where o.id=(resource->>'observation_id')::uuid and o.workspace_id=workspace;
 elsif tg_table_name='lv_agency_alerts' and resource->>'camera_id' is not null then
   select c.minimum_clearance into required from public.lv_cameras c where c.id=(resource->>'camera_id')::uuid and c.workspace_id=workspace;
 end if;
 if required is null or not public.lv_has_scope(workspace,module_name,required) then raise exception 'Your role or clearance does not permit this operation'; end if;
 if tg_table_name in ('lv_cameras','lv_records') and tg_op='UPDATE'
 and not public.lv_has_scope(workspace,module_name,coalesce((to_jsonb(old)->>'minimum_clearance')::integer,0)) then raise exception 'Resource clearance exceeded'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.lv_guard_resource_access() from public,anon,authenticated;
create trigger lv_camera_access_guard before insert or update on public.lv_cameras for each row execute function public.lv_guard_resource_access();
create trigger lv_record_access_guard before insert or update on public.lv_records for each row execute function public.lv_guard_resource_access();
create trigger lv_observation_access_guard before insert on public.lv_video_observations for each row execute function public.lv_guard_resource_access();
create trigger lv_evidence_access_guard before insert on public.lv_agency_evidence for each row execute function public.lv_guard_resource_access();
create trigger lv_alert_update_access_guard before update on public.lv_agency_alerts for each row execute function public.lv_guard_resource_access();

do $$ declare item text; scope text; begin
 if to_regprocedure('public.lv_workspace_permission(uuid,text)') is not null then
   execute $func$create or replace function public.lv_workspace_permission(target uuid, permission text) returns boolean
   language sql stable security definer set search_path='' as $body$
    select public.lv_has_scope(target,case when permission like 'watchlist_%' or permission='registry_write' then 'vehicles' else 'monitor' end)
    and exists(select 1 from public.lv_memberships m where m.workspace_id=target and m.user_id=auth.uid() and public.lv_role_can(m.role,permission))
   $body$ $func$;
 end if;
 if to_regprocedure('public.lv_feature_enabled(uuid,text)') is not null then
   execute $func$create or replace function public.lv_feature_enabled(target uuid,feature_name text) returns boolean
   language sql stable security definer set search_path='' as $body$
    select coalesce((select f.enabled from public.lv_workspace_features f where f.workspace_id=target and f.feature=feature_name),
      (select case w.kind when 'agency' then feature_name<>'business_intelligence'
      when 'business' then feature_name in ('people_analytics','vehicle_analytics','advanced_detection','business_intelligence') else false end from public.lv_workspaces w where w.id=target),false)
    and (exists(select 1 from public.lv_platform_admins a where a.user_id=auth.uid())
      or public.lv_has_scope(target,case when feature_name in ('anpr','vehicle_registry') then 'vehicles' else 'analytics' end))
   $body$ $func$;
 end if;
 foreach item in array array['lv_intel_events','lv_camera_intel_settings','lv_vehicle_watchlist','lv_vehicle_registry','lv_registry_imports'] loop
   if to_regclass('public.'||item) is null then continue; end if;
   scope:=case when item='lv_intel_events' then 'analytics' when item='lv_camera_intel_settings' then 'monitor' else 'vehicles' end;
   execute format('create policy lv_resource_scope on public.%I as restrictive for all to authenticated using(public.lv_has_scope(workspace_id,%L)) with check(public.lv_has_scope(workspace_id,%L))',item,scope,scope);
   if item in ('lv_intel_events','lv_camera_intel_settings') then
     execute format('create policy lv_resource_camera_clearance on public.%I as restrictive for select to authenticated using(camera_id is null or exists(select 1 from public.lv_cameras c where c.id=%I.camera_id))',item,item);
   end if;
   execute format('create trigger lv_resource_access_guard before insert or update or delete on public.%I for each row execute function public.lv_guard_resource_access()',item);
 end loop;
 if to_regclass('public.lv_intel_events') is not null then
   execute $policy$create policy lv_snapshot_scope on storage.objects as restrictive for select to authenticated using(
    bucket_id<>'lv-intel-snapshots' or exists(select 1 from public.lv_intel_events e where e.snapshot_path=storage.objects.name))$policy$;
 end if;
end $$;
create policy lv_vehicle_photo_scope on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'lv-vehicle-photos' or exists(select 1 from public.lv_workspaces w where w.id::text=split_part(storage.objects.name,'/',1) and public.lv_has_scope(w.id,'vehicles')))
 with check(bucket_id<>'lv-vehicle-photos' or exists(select 1 from public.lv_workspaces w where w.id::text=split_part(storage.objects.name,'/',1) and public.lv_has_scope(w.id,'vehicles')));
commit;


-- ----------------------------------------------------------------------------
-- STEP 14/17: 202611120003_enterprise_enrollment_migration.sql
-- ----------------------------------------------------------------------------
begin;

-- ---------------------------------------------------------------------------
-- 1. Feature governance extensions (Biometric Enrollment & 1:N Face Search)
-- ---------------------------------------------------------------------------
alter table public.lv_workspace_features drop constraint if exists lv_workspace_features_feature_check;
alter table public.lv_workspace_features add constraint lv_workspace_features_feature_check
  check (feature in (
    'people_analytics','vehicle_analytics','advanced_detection',
    'anpr','vehicle_registry','security_intelligence','business_intelligence',
    'biometric_enrollment','face_search'
  ));

do $$ begin
  if to_regprocedure('public.lv_has_scope(uuid,text,integer)') is null then
    execute $fn$
      create or replace function public.lv_feature_enabled(target uuid, feature_name text) returns boolean
      language sql stable security definer set search_path='' as $body$
        select coalesce(
          (select f.enabled from public.lv_workspace_features f where f.workspace_id=target and f.feature=feature_name),
          (select case w.kind
              when 'agency' then feature_name <> 'business_intelligence'
              when 'business' then feature_name in ('people_analytics','vehicle_analytics','advanced_detection','business_intelligence')
              else false end
           from public.lv_workspaces w where w.id=target),
          false)
      $body$;
    $fn$;
  end if;
end $$;

create or replace function public.lv_workspace_feature_map(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f text; result jsonb := '{}'::jsonb;
begin
  if not (public.lv_workspace_active(target) or exists(select 1 from public.lv_platform_admins a where a.user_id=auth.uid())) then
    raise exception 'Workspace unavailable';
  end if;
  foreach f in array array[
    'people_analytics','vehicle_analytics','advanced_detection',
    'anpr','vehicle_registry','security_intelligence','business_intelligence',
    'biometric_enrollment','face_search'
  ] loop
    result := result || jsonb_build_object(f, public.lv_feature_enabled(target, f));
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Enterprise Subject Migration Jobs & Authorized Subject Dossiers
-- ---------------------------------------------------------------------------
create table if not exists public.lv_subject_migrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  source_name text not null check (length(btrim(source_name)) between 1 and 120),
  file_name text not null default '' check (length(file_name) <= 240),
  total_records integer not null default 0,
  processed_records integer not null default 0,
  indexed_faces integer not null default 0,
  skipped_duplicates integer not null default 0,
  failed_records integer not null default 0,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','cancelled','failed')),
  errors jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid(),
  created_by_label text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists lv_subject_migrations_recent on public.lv_subject_migrations(workspace_id, created_at desc);

create table if not exists public.lv_agency_subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  subject_code text check (subject_code is null or length(btrim(subject_code)) between 1 and 80),
  full_name text not null check (length(btrim(full_name)) between 1 and 140),
  aliases text not null default '' check (length(aliases) <= 300),
  date_of_birth text not null default '' check (length(date_of_birth) <= 40),
  gender text not null default '' check (length(gender) <= 40),
  nationality text not null default '' check (length(nationality) <= 80),
  category text not null default 'suspect' check (category in ('wanted','suspect','person_of_interest','missing','authorized','other')),
  threat_level text not null default 'medium' check (threat_level in ('low','medium','high','critical')),
  offense_summary text not null default '' check (length(offense_summary) <= 2000),
  warrant_reference text not null default '' check (length(warrant_reference) <= 120),
  case_reference text not null default '' check (length(case_reference) <= 120),
  national_id text not null default '' check (length(national_id) <= 80),
  last_known_location text not null default '' check (length(last_known_location) <= 240),
  physical_marks text not null default '' check (length(physical_marks) <= 1000),
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'active' check (status in ('active','resolved','archived')),
  minimum_clearance integer not null default 0 check (minimum_clearance between 0 and 3),
  primary_photo_path text check (primary_photo_path is null or length(primary_photo_path) <= 300),
  face_token text check (face_token is null or face_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  face_indexed boolean not null default false,
  faceset_outer_id text not null default '' check (length(faceset_outer_id) <= 120),
  source_name text not null default 'manual' check (length(source_name) <= 120),
  migration_id uuid references public.lv_subject_migrations on delete set null,
  revision bigint not null default 1,
  created_by uuid not null default auth.uid(),
  created_by_label text not null default '',
  updated_by uuid,
  updated_by_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lv_agency_subjects_code on public.lv_agency_subjects(workspace_id, subject_code)
  where subject_code is not null;
create index if not exists lv_agency_subjects_token on public.lv_agency_subjects(workspace_id, face_token)
  where face_token is not null;
create index if not exists lv_agency_subjects_recent on public.lv_agency_subjects(workspace_id, status, created_at desc);

create table if not exists public.lv_subject_photos (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.lv_agency_subjects on delete cascade,
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  storage_path text not null check (length(storage_path) <= 300),
  face_token text check (face_token is null or face_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  face_indexed boolean not null default false,
  angle_label text not null default 'frontal' check (angle_label in ('frontal','left_profile','right_profile','surveillance_still','id_document','other')),
  quality_score numeric,
  is_primary boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lv_subject_photos_subject on public.lv_subject_photos(subject_id, is_primary desc, created_at asc);
create index if not exists lv_subject_photos_token on public.lv_subject_photos(workspace_id, face_token)
  where face_token is not null;

create table if not exists public.lv_face_search_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  actor_id uuid not null default auth.uid(),
  actor_label text not null default '',
  search_mode text not null check (search_mode in ('faceset_1n','gallery_1v6','pair_1v1')),
  probe_snapshot_path text check (probe_snapshot_path is null or length(probe_snapshot_path) <= 300),
  top_confidence numeric check (top_confidence is null or top_confidence between 0 and 100),
  result_count integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  telemetry jsonb not null default '{}'::jsonb,
  case_reference text not null default '' check (length(case_reference) <= 120),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists lv_face_search_history_recent on public.lv_face_search_history(workspace_id, created_at desc);

alter table public.lv_subject_migrations enable row level security;
alter table public.lv_agency_subjects enable row level security;
alter table public.lv_subject_photos enable row level security;
alter table public.lv_face_search_history enable row level security;

revoke all on public.lv_subject_migrations, public.lv_agency_subjects, public.lv_subject_photos, public.lv_face_search_history
  from public, anon, authenticated;
grant select on public.lv_subject_migrations, public.lv_agency_subjects, public.lv_subject_photos, public.lv_face_search_history
  to authenticated;

create or replace function public.lv_subject_clearance_ok(target uuid, required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.lv_memberships m
    where m.workspace_id = target and m.user_id = auth.uid()
      and coalesce(to_jsonb(m)->>'clearance', '3')::integer >= coalesce(required_clearance, 0)
  )
$$;
revoke all on function public.lv_subject_clearance_ok(uuid, integer) from public, anon, authenticated;
grant execute on function public.lv_subject_clearance_ok(uuid, integer) to authenticated;

drop policy if exists lv_subject_migrations_read on public.lv_subject_migrations;
create policy lv_subject_migrations_read on public.lv_subject_migrations for select to authenticated using (
  public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id, 'biometric_enrollment')
);
drop policy if exists lv_agency_subjects_read on public.lv_agency_subjects;
create policy lv_agency_subjects_read on public.lv_agency_subjects for select to authenticated using (
  public.lv_agency_member(workspace_id)
  and (public.lv_feature_enabled(workspace_id, 'biometric_enrollment') or public.lv_feature_enabled(workspace_id, 'face_search'))
  and public.lv_subject_clearance_ok(workspace_id, minimum_clearance)
);
drop policy if exists lv_subject_photos_read on public.lv_subject_photos;
create policy lv_subject_photos_read on public.lv_subject_photos for select to authenticated using (
  exists (
    select 1 from public.lv_agency_subjects s
    where s.id = lv_subject_photos.subject_id and s.workspace_id = lv_subject_photos.workspace_id
      and public.lv_agency_member(s.workspace_id)
      and public.lv_subject_clearance_ok(s.workspace_id, s.minimum_clearance)
  )
);
drop policy if exists lv_face_search_history_read on public.lv_face_search_history;
create policy lv_face_search_history_read on public.lv_face_search_history for select to authenticated using (
  public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id, 'face_search')
);

-- ---------------------------------------------------------------------------
-- 3. Subject Enrollment, Migration & Search History RPCs
-- ---------------------------------------------------------------------------
create or replace function public.lv_upsert_agency_subject(target uuid, entry jsonb, photos jsonb default '[]'::jsonb)
returns public.lv_agency_subjects
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  actor_email text;
  claims jsonb;
  sid uuid;
  scode text;
  existing public.lv_agency_subjects;
  saved public.lv_agency_subjects;
  ph jsonb;
  primary_path text;
  primary_token text;
  any_indexed boolean := false;
  actor_clearance integer;
  req_clearance integer;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'biometric_enrollment') then
    raise exception 'Subject enrollment unavailable';
  end if;

  select coalesce(to_jsonb(m)->>'clearance', '3')::integer into actor_clearance
    from public.lv_memberships m where m.workspace_id=target and m.user_id=actor;
  req_clearance := greatest(0, least(3, coalesce(nullif(entry->>'minimum_clearance','')::integer, 0)));
  if req_clearance > coalesce(actor_clearance, 3) then
    raise exception 'Cannot assign clearance higher than your own';
  end if;

  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');

  sid := nullif(entry->>'id', '')::uuid;
  scode := nullif(btrim(coalesce(entry->>'subject_code', '')), '');

  if sid is not null then
    select * into existing from public.lv_agency_subjects where id=sid and workspace_id=target for update;
    if existing.id is null then raise exception 'Subject record not found'; end if;
  elsif scode is not null then
    select * into existing from public.lv_agency_subjects where workspace_id=target and subject_code=scode for update;
  end if;

  if jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0 then
    for ph in select value from jsonb_array_elements(photos) loop
      if coalesce((ph->>'is_primary')::boolean, false) or primary_path is null then
        primary_path := nullif(ph->>'storage_path', '');
        primary_token := nullif(ph->>'face_token', '');
      end if;
      if coalesce((ph->>'face_indexed')::boolean, false) then any_indexed := true; end if;
    end loop;
  end if;

  primary_path := coalesce(primary_path, nullif(entry->>'primary_photo_path', ''), existing.primary_photo_path);
  if primary_path is not null and (primary_path not like target::text || '/%' or primary_path like '%..%') then
    raise exception 'Invalid photo storage path';
  end if;
  primary_token := coalesce(primary_token, nullif(entry->>'face_token', ''), existing.face_token);
  any_indexed := any_indexed or coalesce((entry->>'face_indexed')::boolean, false) or coalesce(existing.face_indexed, false);

  if existing.id is null then
    insert into public.lv_agency_subjects(
      workspace_id, subject_code, full_name, aliases, date_of_birth, gender, nationality,
      category, threat_level, offense_summary, warrant_reference, case_reference, national_id,
      last_known_location, physical_marks, notes, status, minimum_clearance,
      primary_photo_path, face_token, face_indexed, faceset_outer_id, source_name, migration_id,
      created_by, created_by_label
    ) values (
      target, scode, btrim(entry->>'full_name'),
      left(btrim(coalesce(entry->>'aliases','')), 300),
      left(btrim(coalesce(entry->>'date_of_birth','')), 40),
      left(btrim(coalesce(entry->>'gender','')), 40),
      left(btrim(coalesce(entry->>'nationality','')), 80),
      coalesce(nullif(entry->>'category',''), 'suspect'),
      coalesce(nullif(entry->>'threat_level',''), 'medium'),
      left(btrim(coalesce(entry->>'offense_summary','')), 2000),
      left(btrim(coalesce(entry->>'warrant_reference','')), 120),
      left(btrim(coalesce(entry->>'case_reference','')), 120),
      left(btrim(coalesce(entry->>'national_id','')), 80),
      left(btrim(coalesce(entry->>'last_known_location','')), 240),
      left(btrim(coalesce(entry->>'physical_marks','')), 1000),
      left(btrim(coalesce(entry->>'notes','')), 4000),
      coalesce(nullif(entry->>'status',''), 'active'),
      req_clearance,
      primary_path, primary_token, any_indexed,
      left(coalesce(entry->>'faceset_outer_id', 'lv_' || replace(target::text, '-', '')), 120),
      left(coalesce(nullif(btrim(entry->>'source_name'),''), 'manual'), 120),
      nullif(entry->>'migration_id','')::uuid,
      actor, actor_email
    ) returning * into saved;

    insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
      values(target, actor, saved.id, 'subject.enrolled');
  else
    update public.lv_agency_subjects set
      subject_code = coalesce(scode, subject_code),
      full_name = coalesce(nullif(btrim(entry->>'full_name'),''), full_name),
      aliases = coalesce(nullif(left(btrim(coalesce(entry->>'aliases','')), 300),''), aliases),
      date_of_birth = coalesce(nullif(left(btrim(coalesce(entry->>'date_of_birth','')), 40),''), date_of_birth),
      gender = coalesce(nullif(left(btrim(coalesce(entry->>'gender','')), 40),''), gender),
      nationality = coalesce(nullif(left(btrim(coalesce(entry->>'nationality','')), 80),''), nationality),
      category = coalesce(nullif(entry->>'category',''), category),
      threat_level = coalesce(nullif(entry->>'threat_level',''), threat_level),
      offense_summary = coalesce(nullif(left(btrim(coalesce(entry->>'offense_summary','')), 2000),''), offense_summary),
      warrant_reference = coalesce(nullif(left(btrim(coalesce(entry->>'warrant_reference','')), 120),''), warrant_reference),
      case_reference = coalesce(nullif(left(btrim(coalesce(entry->>'case_reference','')), 120),''), case_reference),
      national_id = coalesce(nullif(left(btrim(coalesce(entry->>'national_id','')), 80),''), national_id),
      last_known_location = coalesce(nullif(left(btrim(coalesce(entry->>'last_known_location','')), 240),''), last_known_location),
      physical_marks = coalesce(nullif(left(btrim(coalesce(entry->>'physical_marks','')), 1000),''), physical_marks),
      notes = coalesce(nullif(left(btrim(coalesce(entry->>'notes','')), 4000),''), notes),
      status = coalesce(nullif(entry->>'status',''), status),
      minimum_clearance = req_clearance,
      primary_photo_path = coalesce(primary_path, primary_photo_path),
      face_token = coalesce(primary_token, face_token),
      face_indexed = any_indexed,
      faceset_outer_id = coalesce(nullif(entry->>'faceset_outer_id',''), faceset_outer_id),
      source_name = coalesce(nullif(btrim(entry->>'source_name'),''), source_name),
      migration_id = coalesce(nullif(entry->>'migration_id','')::uuid, migration_id),
      revision = revision + 1,
      updated_at = now(),
      updated_by = actor,
      updated_by_label = actor_email
    where id = existing.id returning * into saved;

    insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
      values(target, actor, saved.id, 'subject.updated');
  end if;

  if jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0 then
    for ph in select value from jsonb_array_elements(photos) loop
      if nullif(ph->>'storage_path','') is not null then
        if (ph->>'storage_path') not like target::text || '/%' or (ph->>'storage_path') like '%..%' then
          raise exception 'Invalid photo storage path';
        end if;
        insert into public.lv_subject_photos(
          subject_id, workspace_id, storage_path, face_token, face_indexed, angle_label, quality_score, is_primary, created_by
        ) values (
          saved.id, target, ph->>'storage_path', nullif(ph->>'face_token',''),
          coalesce((ph->>'face_indexed')::boolean, false),
          coalesce(nullif(ph->>'angle_label',''), 'frontal'),
          nullif(ph->>'quality_score','')::numeric,
          coalesce((ph->>'is_primary')::boolean, false),
          actor
        );
      end if;
    end loop;
  end if;

  return saved;
end $$;
revoke all on function public.lv_upsert_agency_subject(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lv_upsert_agency_subject(uuid,jsonb,jsonb) to authenticated;

create or replace function public.lv_start_subject_migration(target uuid, source_label text, filename text, total integer)
returns uuid
language plpgsql security definer set search_path='' as $$
declare mid uuid; claims jsonb; actor_email text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'biometric_enrollment') then
    raise exception 'Subject migration unavailable';
  end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');
  insert into public.lv_subject_migrations(workspace_id, source_name, file_name, total_records, created_by, created_by_label)
    values(target, left(btrim(source_label), 120), left(coalesce(filename,''), 240), greatest(1, total), auth.uid(), actor_email)
    returning id into mid;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
    values(target, auth.uid(), mid, 'subject.migration_started');
  return mid;
end $$;
revoke all on function public.lv_start_subject_migration(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.lv_start_subject_migration(uuid,text,text,integer) to authenticated;

create or replace function public.lv_update_subject_migration(target_migration uuid, processed integer, indexed integer, duplicates integer, failed integer, next_status text, err_list jsonb default '[]'::jsonb)
returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_subject_migrations;
begin
  select * into item from public.lv_subject_migrations where id=target_migration for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_write') then
    raise exception 'Migration job unavailable';
  end if;
  update public.lv_subject_migrations set
    processed_records = processed,
    indexed_faces = indexed,
    skipped_duplicates = duplicates,
    failed_records = failed,
    status = next_status,
    errors = err_list,
    completed_at = case when next_status in ('completed','completed_with_errors','cancelled','failed') then now() else completed_at end
  where id = target_migration;
end $$;
revoke all on function public.lv_update_subject_migration(uuid,integer,integer,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.lv_update_subject_migration(uuid,integer,integer,integer,integer,text,jsonb) to authenticated;

create or replace function public.lv_retire_agency_subject(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_subjects;
begin
  select * into item from public.lv_agency_subjects where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_archive') then
    raise exception 'Subject record unavailable';
  end if;
  update public.lv_agency_subjects set status='archived', updated_at=now(), updated_by=auth.uid(), revision=revision+1 where id=target_id;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action) values(item.workspace_id, auth.uid(), target_id, 'subject.archived');
end $$;
revoke all on function public.lv_retire_agency_subject(uuid) from public,anon,authenticated;
grant execute on function public.lv_retire_agency_subject(uuid) to authenticated;

create or replace function public.lv_delete_agency_subject(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_subjects;
begin
  select * into item from public.lv_agency_subjects where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_delete') then
    raise exception 'Subject record unavailable';
  end if;
  delete from public.lv_agency_subjects where id=target_id;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action) values(item.workspace_id, auth.uid(), target_id, 'subject.deleted');
end $$;
revoke all on function public.lv_delete_agency_subject(uuid) from public,anon,authenticated;
grant execute on function public.lv_delete_agency_subject(uuid) to authenticated;

create or replace function public.lv_log_face_search(target uuid, mode text, probe_path text, confidence numeric, matches jsonb, telemetry jsonb default '{}'::jsonb, case_ref text default '', search_notes text default '')
returns uuid
language plpgsql security definer set search_path='' as $$
declare hid uuid; claims jsonb; actor_email text; n integer := 0;
begin
  if not public.lv_agency_member(target) or not public.lv_feature_enabled(target, 'face_search') then
    raise exception 'Face search unavailable';
  end if;
  if probe_path is not null and (probe_path not like target::text || '/%' or probe_path like '%..%') then
    raise exception 'Invalid probe snapshot path';
  end if;
  if jsonb_typeof(matches) = 'array' then n := jsonb_array_length(matches); end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');
  insert into public.lv_face_search_history(workspace_id, actor_id, actor_label, search_mode, probe_snapshot_path, top_confidence, result_count, results, telemetry, case_reference, notes)
    values(target, auth.uid(), actor_email, mode, probe_path, confidence, n, coalesce(matches,'[]'::jsonb), coalesce(telemetry,'{}'::jsonb), left(coalesce(case_ref,''),120), left(coalesce(search_notes,''),1000))
    returning id into hid;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
    values(target, auth.uid(), hid, 'face.search_' || mode);
  return hid;
end $$;
revoke all on function public.lv_log_face_search(uuid,text,text,numeric,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.lv_log_face_search(uuid,text,text,numeric,jsonb,jsonb,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bulk Plate Watchlist Migration RPC (supports large CSV/Excel + photo batches)
-- ---------------------------------------------------------------------------
create or replace function public.lv_import_watchlist(target uuid, source_name text, file_name text, entries jsonb, update_existing boolean default false)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r jsonb; ord integer := 0; p text; reason_val text; case_val text; st_val text; custom_cat text; photo_p text;
  existing public.lv_vehicle_watchlist;
  ins integer := 0; upd integer := 0; dup integer := 0; bad integer := 0; errs jsonb := '[]'::jsonb; seen text[] := '{}';
  claims jsonb; actor_email text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'anpr') then
    raise exception 'Watchlist import unavailable';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 2000 then
    raise exception 'Import between 1 and 2000 rows per batch';
  end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');

  for r in select value from jsonb_array_elements(entries) loop
    ord := ord + 1;
    p := public.lv_normalize_plate(r->>'plate');
    if p !~ '^[A-Z0-9]{2,12}$' then
      bad := bad + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',coalesce(r->>'plate',''),'error','Plate must be 2 to 12 letters or digits')); end if;
      continue;
    end if;
    if p = any(seen) then
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Duplicate plate within batch')); end if;
      continue;
    end if;
    seen := seen || p;

    reason_val := lower(coalesce(nullif(btrim(r->>'category'),''), nullif(btrim(r->>'reason'),''), 'interest'));
    if reason_val not in ('stolen','wanted','interest','authorized','other','watchlist') then reason_val := 'other'; end if;
    custom_cat := case when reason_val='other' then coalesce(nullif(btrim(r->>'custom_category'),''), btrim(coalesce(r->>'category', r->>'reason', 'Migrated'))) else '' end;
    case_val := coalesce(nullif(btrim(r->>'case_reference'),''), nullif(btrim(source_name),''), 'MIGRATION');
    st_val := lower(coalesce(nullif(btrim(r->>'status'),''), 'active'));
    if st_val not in ('active','inactive','resolved') then st_val := 'active'; end if;
    photo_p := nullif(btrim(coalesce(r->>'photo_path','')), '');
    if photo_p is not null and (photo_p not like target::text || '/%' or photo_p like '%..%') then photo_p := null; end if;

    select * into existing from public.lv_vehicle_watchlist where workspace_id=target and plate=p and retired_at is null;
    if existing.id is null then
      insert into public.lv_vehicle_watchlist(
        workspace_id, plate, reason, custom_category, case_reference, make, model, colour,
        photo_path, description, notes, status, created_by, created_by_label
      ) values (
        target, p, reason_val, left(custom_cat,60), left(case_val,120),
        left(btrim(coalesce(r->>'make','')),60), left(btrim(coalesce(r->>'model','')),60), left(btrim(coalesce(r->>'colour','')),60),
        photo_p, left(btrim(coalesce(r->>'description','')),2000), left(btrim(coalesce(r->>'notes','')),4000),
        st_val, auth.uid(), actor_email
      );
      ins := ins + 1;
    elsif coalesce(update_existing, false) then
      update public.lv_vehicle_watchlist set
        reason = reason_val,
        custom_category = left(custom_cat,60),
        case_reference = left(case_val,120),
        make = coalesce(nullif(left(btrim(coalesce(r->>'make','')),60),''), make),
        model = coalesce(nullif(left(btrim(coalesce(r->>'model','')),60),''), model),
        colour = coalesce(nullif(left(btrim(coalesce(r->>'colour','')),60),''), colour),
        photo_path = coalesce(photo_p, photo_path),
        description = coalesce(nullif(left(btrim(coalesce(r->>'description','')),2000),''), description),
        notes = coalesce(nullif(left(btrim(coalesce(r->>'notes','')),4000),''), notes),
        status = st_val,
        revision = revision + 1,
        updated_at = now(),
        updated_by = auth.uid(),
        updated_by_label = actor_email
      where id = existing.id;
      upd := upd + 1;
    else
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Active watchlist plate already exists')); end if;
    end if;
  end loop;

  insert into public.lv_workspace_activity(workspace_id, actor_id, action)
    values(target, auth.uid(), 'watchlist.migrated_' || left(coalesce(btrim(file_name),'batch'), 40));

  return jsonb_build_object('total',ord,'inserted',ins,'updated',upd,'duplicates',dup,'invalid',bad,'errors',errs);
end $$;
revoke all on function public.lv_import_watchlist(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.lv_import_watchlist(uuid,text,text,jsonb,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Private Storage Bucket for Enrolled Subject Photos & Probe Snapshots
-- ---------------------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-subject-photos','lv-subject-photos',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists lv_subject_photo_read on storage.objects;
create policy lv_subject_photo_read on storage.objects for select to authenticated using (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
drop policy if exists lv_subject_photo_upload on storage.objects;
create policy lv_subject_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and (public.lv_workspace_permission(w.id,'watchlist_write') or public.lv_feature_enabled(w.id,'face_search')))
);
drop policy if exists lv_subject_photo_delete on storage.objects;
create policy lv_subject_photo_delete on storage.objects for delete to authenticated using (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and public.lv_workspace_permission(w.id,'watchlist_write'))
);

commit;


-- ----------------------------------------------------------------------------
-- STEP 15/17: 202611120004_preserve_staff_access.sql
-- ----------------------------------------------------------------------------
begin;
-- Older deployed clients can still change a role without silently erasing a staff member's explicit permissions.
create or replace function public.lv_manage_workspace_access(target uuid,email_address text,access_role text) returns void
language plpgsql security definer set search_path='' as $$
declare saved public.lv_memberships;
begin
 select m.* into saved from public.lv_memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=target and lower(u.email)=lower(btrim(email_address));
 perform public.lv_set_staff_access(target,email_address,access_role,coalesce(saved.clearance,0),coalesce(saved.allowed_modules,array['monitor']));
end $$;
revoke all on function public.lv_manage_workspace_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lv_manage_workspace_access(uuid,text,text) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 16/17: 202611120005_camera_connections.sql
-- ----------------------------------------------------------------------------
begin;
create function public.lv_configure_camera_connection(target uuid,expected_revision bigint,device_name text,device_location text,endpoint text,format text,clearance integer)
returns void language plpgsql security definer set search_path='' as $$
declare item public.lv_cameras;
begin
 select * into item from public.lv_cameras where id=target for update;
 if item.id is null or not public.lv_workspace_active(item.workspace_id) or not exists(
 select 1 from public.lv_memberships m where m.workspace_id=item.workspace_id and m.user_id=auth.uid() and m.role in ('owner','admin'))
 then raise exception 'Camera configuration unavailable'; end if;
 if expected_revision is null or item.revision<>expected_revision then raise exception 'Camera changed. Refresh before editing.'; end if;
 update public.lv_cameras set name=btrim(device_name),location=btrim(device_location),playback_url=endpoint,
 stream_type=format,minimum_clearance=clearance where id=target;
end $$;
revoke all on function public.lv_configure_camera_connection(uuid,bigint,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.lv_configure_camera_connection(uuid,bigint,text,text,text,text,integer) to authenticated;
commit;


-- ----------------------------------------------------------------------------
-- STEP 17/17: 202611120006_viewer_write_guards.sql
-- ----------------------------------------------------------------------------
begin;
create function public.lv_staff_can_write(target uuid,module_name text,required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
 select public.lv_has_scope(target,module_name,required_clearance) and exists(select 1 from public.lv_memberships m
 where m.workspace_id=target and m.user_id=auth.uid() and m.role<>'viewer')
$$;
revoke all on function public.lv_staff_can_write(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lv_staff_can_write(uuid,text,integer) to authenticated;
create policy lv_rule_module_access on public.lv_agency_rules as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'analytics')) with check(public.lv_staff_can_write(workspace_id,'analytics'));

create function public.lv_guard_alert_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare camera uuid; required integer:=0; module_name text;
begin
 if auth.uid() is null then return new; end if;
 camera:=(to_jsonb(new)->>'camera_id')::uuid;
 if camera is null and new.observation_id is not null then select o.camera_id into camera from public.lv_video_observations o where o.id=new.observation_id; end if;
 if camera is not null then select c.minimum_clearance into required from public.lv_cameras c where c.id=camera and c.workspace_id=new.workspace_id; end if;
 module_name:=case when new.observation_id is not null or to_jsonb(new)->>'event_id' is not null then 'analytics' else 'monitor' end;
 if required is null or not public.lv_staff_can_write(new.workspace_id,module_name,required) then raise exception 'Alert creation is not permitted for this account'; end if;
 return new;
end $$;
revoke all on function public.lv_guard_alert_insert() from public,anon,authenticated;
create trigger lv_alert_insert_guard before insert on public.lv_agency_alerts for each row execute function public.lv_guard_alert_insert();

create function public.lv_guard_corrective_access() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; parent public.lv_records;
begin
 if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
 item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 select * into parent from public.lv_records where id=(item->>'incident_id')::uuid;
 if parent.id is null or not public.lv_staff_can_write(parent.workspace_id,'records',parent.minimum_clearance)
 then raise exception 'Corrective action access is not permitted'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.lv_guard_corrective_access() from public,anon,authenticated;
create trigger lv_corrective_access_guard before insert or update or delete on public.lv_corrective_actions for each row execute function public.lv_guard_corrective_access();
create policy lv_operational_upload_permissions on storage.objects as restrictive for insert to authenticated with check(
 bucket_id not in ('lv-agency-evidence','lv-intel-snapshots') or exists(select 1 from public.lv_workspaces w
 where w.id::text=split_part(storage.objects.name,'/',1) and public.lv_staff_can_write(w.id,case when bucket_id='lv-agency-evidence' then 'evidence' else 'analytics' end))
);
commit;
