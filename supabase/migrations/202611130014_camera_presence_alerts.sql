begin;
create table public.lv_camera_presence_options (
 camera_id uuid primary key references public.lv_cameras on delete cascade,
 people boolean not null default true, vehicles boolean not null default true,
 minimum_score numeric not null default 0.65 check(minimum_score between 0.5 and 1),
 cooldown_seconds integer not null default 60 check(cooldown_seconds between 15 and 3600),
 revision bigint not null default 1
);
alter table public.lv_camera_presence_options enable row level security;
revoke all on public.lv_camera_presence_options from public,anon,authenticated;

create function public.lv_get_camera_presence_options(target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras; options public.lv_camera_presence_options;
begin
 select * into camera from public.lv_cameras where id=target;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance) then raise exception 'Camera unavailable' using errcode='42501'; end if;
 select * into options from public.lv_camera_presence_options where camera_id=target;
 return jsonb_build_object('workspace_id',camera.workspace_id,'people',coalesce(options.people,true) and public.lv_feature_enabled(camera.workspace_id,'people_analytics'),
 'vehicles',coalesce(options.vehicles,true) and public.lv_feature_enabled(camera.workspace_id,'vehicle_analytics'),
 'minimum_score',coalesce(options.minimum_score,0.65),'cooldown_seconds',coalesce(options.cooldown_seconds,60),'revision',coalesce(options.revision,0),
 'can_record',public.lv_staff_can_write(camera.workspace_id,'analytics',camera.minimum_clearance),
 'can_manage',public.lv_has_scope(camera.workspace_id,'analytics',camera.minimum_clearance) and exists(select 1 from public.lv_memberships where workspace_id=camera.workspace_id and user_id=auth.uid() and role in ('owner','admin')));
end $$;
revoke all on function public.lv_get_camera_presence_options(uuid) from public,anon,authenticated;
grant execute on function public.lv_get_camera_presence_options(uuid) to authenticated;

create function public.lv_save_camera_presence_options(target uuid,expected_revision bigint,people_enabled boolean,vehicles_enabled boolean,minimum_confidence numeric,repeat_seconds integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras; options public.lv_camera_presence_options; saved bigint;
begin
 select * into camera from public.lv_cameras where id=target for update;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance) or not public.lv_has_scope(camera.workspace_id,'analytics',camera.minimum_clearance)
 or not exists(select 1 from public.lv_memberships where workspace_id=camera.workspace_id and user_id=auth.uid() and role in ('owner','admin'))
 then raise exception 'Camera alert management unavailable' using errcode='42501'; end if;
 select * into options from public.lv_camera_presence_options where camera_id=target;
 if expected_revision is null or expected_revision<>coalesce(options.revision,0) then raise exception 'Alert settings changed. Refresh before editing.'; end if;
 insert into public.lv_camera_presence_options(camera_id,people,vehicles,minimum_score,cooldown_seconds)
 values(target,people_enabled,vehicles_enabled,minimum_confidence,repeat_seconds)
 on conflict(camera_id) do update set people=excluded.people,vehicles=excluded.vehicles,minimum_score=excluded.minimum_score,cooldown_seconds=excluded.cooldown_seconds,revision=lv_camera_presence_options.revision+1
 returning revision into saved;
 return saved;
end $$;
revoke all on function public.lv_save_camera_presence_options(uuid,bigint,boolean,boolean,numeric,integer) from public,anon,authenticated;
grant execute on function public.lv_save_camera_presence_options(uuid,bigint,boolean,boolean,numeric,integer) to authenticated;

-- Aggregate presence only: no face images, identities, embeddings or matching.
create function public.lv_record_camera_presence(target uuid,source_revision bigint,sample_id uuid,people_count integer,vehicle_count integer,confidence numeric,observed_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare camera public.lv_cameras; options public.lv_camera_presence_options; config jsonb; item record; evt public.lv_intel_events; alert_id uuid; alerts jsonb:='[]'::jsonb; event_key uuid; event_title text;
begin
 select * into camera from public.lv_cameras where id=target;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance) or not public.lv_staff_can_write(camera.workspace_id,'analytics',camera.minimum_clearance)
 then raise exception 'Camera alert recording unavailable' using errcode='42501'; end if;
 if sample_id is null or people_count is null or vehicle_count is null or people_count not between 0 and 1000 or vehicle_count not between 0 and 1000
 or confidence is null or confidence not between 0 and 1 or observed_at is null or observed_at<now()-interval '2 minutes' or observed_at>now()+interval '30 seconds' then raise exception 'Invalid presence observation'; end if;
 if not exists(select 1 from public.lv_camera_source_secrets s join public.lv_camera_connection_health h on h.camera_id=s.camera_id and h.source_revision=s.source_revision
 join public.lv_camera_gateways g on g.id=camera.gateway_id and g.id=h.gateway_id and g.enabled and g.last_seen_at>now()-interval '45 seconds'
 where s.camera_id=target and s.source_revision=lv_record_camera_presence.source_revision and h.state='ready')
 then raise exception 'A verified, connected camera source is required'; end if;
 select * into options from public.lv_camera_presence_options where camera_id=target;
 if (people_count+vehicle_count)>0 and confidence<coalesce(options.minimum_score,0.65) then raise exception 'Observation confidence is below the camera threshold'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('presence:'||target::text,0));
 for item in select * from (values ('person'::text,people_count,coalesce(options.people,true),'people_analytics'::text,'person_presence'::text),('vehicle',vehicle_count,coalesce(options.vehicles,true),'vehicle_analytics','vehicle_presence')) as kinds(class,total,enabled,feature,category) loop
   if not item.enabled or not public.lv_feature_enabled(camera.workspace_id,item.feature) then continue; end if;
   event_key:=pg_catalog.md5(sample_id::text||':'||item.class)::uuid;
   insert into public.lv_intel_events(workspace_id,camera_id,category,object_class,event_count,confidence,payload,source,occurred_at,request_id,created_by)
   values(camera.workspace_id,target,'census',item.class,item.total,confidence,jsonb_build_object('presence_only',true,'source_revision',source_revision),'camera',observed_at,event_key,auth.uid())
   on conflict(workspace_id,created_by,request_id) do nothing returning * into evt;
   if evt.id is null or item.total=0 then continue; end if;
   if exists(select 1 from public.lv_agency_alerts a where a.workspace_id=camera.workspace_id and a.camera_id=target and a.category=item.category and a.created_at>clock_timestamp()-make_interval(secs=>coalesce(options.cooldown_seconds,60))) then continue; end if;
   event_title:=case item.class when 'person' then 'Person presence detected' else 'Vehicle detected' end;
   insert into public.lv_agency_alerts(workspace_id,camera_id,event_id,category,title,details,severity,recommended_action,dedupe_key,created_by)
   values(camera.workspace_id,target,evt.id,item.category,event_title,item.total||' '||item.class||' detected on '||camera.name||'. Aggregate detection; no person identity is inferred.','low','Review the live stream and verify the detection.',item.category,auth.uid()) returning id into alert_id;
   alerts:=alerts||jsonb_build_array(jsonb_build_object('id',alert_id,'event_id',evt.id,'kind',item.category,'title',event_title,'count',item.total));
 end loop;
 return jsonb_build_object('alerts',alerts);
end $$;
revoke all on function public.lv_record_camera_presence(uuid,bigint,uuid,integer,integer,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.lv_record_camera_presence(uuid,bigint,uuid,integer,integer,numeric,timestamptz) to authenticated;
commit;
