begin;
create function public.lv_update_gateway_endpoint(target uuid,new_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
declare gateway public.lv_camera_gateways;
begin
 select * into gateway from public.lv_camera_gateways where id=target for update;
 if gateway.id is null or not public.lv_has_scope(gateway.workspace_id,'monitor',gateway.clearance)
 or not exists(select 1 from public.lv_memberships where workspace_id=gateway.workspace_id and user_id=auth.uid() and role in ('owner','admin'))
 then raise exception 'Gateway management unavailable' using errcode='42501'; end if;
 update public.lv_camera_gateways set endpoint=rtrim(btrim(new_endpoint),'/') where id=target;
 delete from public.lv_camera_playback_tickets where gateway_id=target;
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action) values(gateway.workspace_id,auth.uid(),gateway.id,'gateway.endpoint_changed');
end $$;
revoke all on function public.lv_update_gateway_endpoint(uuid,text) from public,anon,authenticated;
grant execute on function public.lv_update_gateway_endpoint(uuid,text) to authenticated;
commit;
