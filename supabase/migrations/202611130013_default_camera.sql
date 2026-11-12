begin;
alter table public.lv_cameras add column is_default boolean not null default false;
create unique index lv_camera_workspace_default on public.lv_cameras(workspace_id) where is_default;
create function public.lv_set_default_camera(target uuid,expected_revision bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare workspace uuid; camera public.lv_cameras;
begin
 select workspace_id into workspace from public.lv_cameras where id=target;
 perform 1 from public.lv_workspaces where id=workspace for update;
 select * into camera from public.lv_cameras where id=target for update;
 if camera.id is null or not public.lv_has_scope(camera.workspace_id,'monitor',camera.minimum_clearance)
 or not exists(select 1 from public.lv_memberships where workspace_id=camera.workspace_id and user_id=auth.uid() and role in ('owner','admin'))
 or exists(select 1 from public.lv_cameras c where c.workspace_id=camera.workspace_id and c.is_default and not public.lv_has_scope(c.workspace_id,'monitor',c.minimum_clearance))
 then raise exception 'Default camera management unavailable' using errcode='42501'; end if;
 if expected_revision is null or camera.revision<>expected_revision then raise exception 'Camera changed. Refresh before editing.' using errcode='40001'; end if;
 update public.lv_cameras set is_default=false where workspace_id=camera.workspace_id and id<>target and is_default;
 update public.lv_cameras set is_default=true where id=target and not is_default;
 return target;
end $$;
revoke all on function public.lv_set_default_camera(uuid,bigint) from public,anon,authenticated;
grant execute on function public.lv_set_default_camera(uuid,bigint) to authenticated;
commit;
