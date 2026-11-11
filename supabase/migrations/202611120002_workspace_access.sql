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
