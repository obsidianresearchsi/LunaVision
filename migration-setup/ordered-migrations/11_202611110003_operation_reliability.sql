-- Step 11/17: 202611110003_operation_reliability.sql
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
