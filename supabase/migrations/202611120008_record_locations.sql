begin;
alter table public.lv_records drop constraint lv_investigation_coordinates;
alter table public.lv_records add constraint lv_record_coordinates check (
 (latitude is null and longitude is null) or
 (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
);
grant insert(latitude,longitude) on public.lv_records to authenticated;
create policy lv_business_record_location on public.lv_records for update to authenticated
 using(public.lv_has_scope(lv_records.workspace_id,'records',lv_records.minimum_clearance)
 and exists(select 1 from public.lv_workspaces w where w.id=lv_records.workspace_id and w.kind='business' and w.active)
 and exists(select 1 from public.lv_memberships m where m.workspace_id=lv_records.workspace_id and m.user_id=auth.uid() and m.role<>'viewer'))
 with check(public.lv_has_scope(lv_records.workspace_id,'records',lv_records.minimum_clearance));
commit;
