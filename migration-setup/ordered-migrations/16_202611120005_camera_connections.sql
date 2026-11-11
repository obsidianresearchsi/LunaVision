-- Step 16/17: 202611120005_camera_connections.sql
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
