begin;

-- 1. Allow direct open -> resolved transitions on incidents/investigations and alerts
create or replace function public.lv_change_record_status(target_id uuid, expected_status text, new_status text)
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
    (expected_status='open' and new_status in ('in_review','resolved'))
    or (expected_status='in_review' and new_status in ('open','resolved'))
    or (expected_status='resolved' and new_status in ('open','in_review')), false
  ) then raise exception 'Invalid status transition'; end if;
  update public.lv_records set status=new_status where id=target_id returning * into current_record;
  insert into public.lv_record_activity(record_id,actor_id,previous_status,next_status)
    values(target_id,actor,expected_status,new_status);
  return current_record;
end $$;

create or replace function public.lv_transition_alert(target uuid, expected text, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_alerts;
begin
  select * into item from public.lv_agency_alerts where id=target for update;
  if item.id is null or not public.lv_workspace_active(item.workspace_id)
    or (item.category is not distinct from 'watchlist_match' and not public.lv_agency_member(item.workspace_id)) then
    raise exception 'Alert unavailable'; end if;
  if item.status<>expected then raise exception 'Alert changed. Refresh and retry.'; end if;
  if next_status is null or not ((expected='open' and next_status in ('acknowledged','resolved'))
    or (expected='acknowledged' and next_status in ('resolved','open'))
    or (expected='resolved' and next_status='open'))
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

-- 2. Expand AI rules object_label options to include knife & person
alter table public.lv_agency_rules drop constraint if exists lv_agency_rules_object_label_check;
alter table public.lv_agency_rules add constraint lv_agency_rules_object_label_check
  check(object_label in ('car','truck','bus','motorcycle','bicycle','boat','airplane','train','fire hydrant','backpack','suitcase','knife','person'));

-- 3. Allow weapon_detection capability in lv_validate_intel_settings
create or replace function public.lv_validate_intel_settings(target uuid, s jsonb) returns void
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
        when 'weapon_detection' then 'advanced_detection'
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

commit;
