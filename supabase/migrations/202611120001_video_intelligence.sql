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

