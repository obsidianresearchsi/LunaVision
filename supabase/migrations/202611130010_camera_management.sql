begin;

-- Saved sources are not authenticated camera connections. Metadata can be edited
-- before a gateway is installed; a null endpoint intentionally leaves playback off.
create or replace function public.lv_configure_camera_connection(target uuid,expected_revision bigint,device_name text,device_location text,endpoint text,format text,clearance integer)
returns void language plpgsql security definer set search_path='' as $$
declare item public.lv_cameras;
begin
 select * into item from public.lv_cameras where id=target for update;
 if item.id is null or not public.lv_has_scope(item.workspace_id,'monitor',item.minimum_clearance)
 or not exists(select 1 from public.lv_memberships m where m.workspace_id=item.workspace_id and m.user_id=auth.uid() and m.role in ('owner','admin'))
 then raise exception 'Camera configuration unavailable' using errcode='42501'; end if;
 if expected_revision is null or item.revision<>expected_revision then raise exception 'Camera changed. Refresh before editing.' using errcode='40001'; end if;
 if clearance is null or clearance not between 0 and 3 or not public.lv_has_scope(item.workspace_id,'monitor',clearance)
 then raise exception 'Insufficient camera clearance' using errcode='42501'; end if;
 update public.lv_cameras set name=btrim(device_name),location=btrim(device_location),playback_url=nullif(btrim(endpoint),''),
 stream_type=format,minimum_clearance=clearance where id=target;
end $$;
revoke all on function public.lv_configure_camera_connection(uuid,bigint,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.lv_configure_camera_connection(uuid,bigint,text,text,text,text,integer) to authenticated;

-- Delete only a camera the current manager can see, and reject stale requests.
-- Existing FK actions retain observations and delete settings and the Vault mapping.
create or replace function public.lv_remove_camera(target uuid,expected_revision bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.lv_cameras;
begin
 select * into item from public.lv_cameras where id=target for update;
 if item.id is null or not public.lv_has_scope(item.workspace_id,'monitor',item.minimum_clearance)
 or not exists(select 1 from public.lv_memberships m where m.workspace_id=item.workspace_id and m.user_id=auth.uid() and m.role in ('owner','admin'))
 then raise exception 'Camera removal unavailable' using errcode='42501'; end if;
 if expected_revision is null or item.revision<>expected_revision then raise exception 'Camera changed. Refresh before removing.' using errcode='40001'; end if;
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
 values(item.workspace_id,auth.uid(),item.id,'camera.removed');
 delete from public.lv_cameras where id=target;
 return target;
end $$;
revoke all on function public.lv_remove_camera(uuid,bigint) from public,anon,authenticated;
grant execute on function public.lv_remove_camera(uuid,bigint) to authenticated;

commit;
