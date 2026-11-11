-- Step 09/17: 202611110001_command_map.sql
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
