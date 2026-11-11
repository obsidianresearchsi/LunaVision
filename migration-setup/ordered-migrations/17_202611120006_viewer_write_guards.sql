-- Step 17/17: 202611120006_viewer_write_guards.sql
begin;
create function public.lv_staff_can_write(target uuid,module_name text,required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
 select public.lv_has_scope(target,module_name,required_clearance) and exists(select 1 from public.lv_memberships m
 where m.workspace_id=target and m.user_id=auth.uid() and m.role<>'viewer')
$$;
revoke all on function public.lv_staff_can_write(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.lv_staff_can_write(uuid,text,integer) to authenticated;
create policy lv_rule_module_access on public.lv_agency_rules as restrictive for all to authenticated
 using(public.lv_has_scope(workspace_id,'analytics')) with check(public.lv_staff_can_write(workspace_id,'analytics'));

create function public.lv_guard_alert_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare camera uuid; required integer:=0; module_name text;
begin
 if auth.uid() is null then return new; end if;
 camera:=(to_jsonb(new)->>'camera_id')::uuid;
 if camera is null and new.observation_id is not null then select o.camera_id into camera from public.lv_video_observations o where o.id=new.observation_id; end if;
 if camera is not null then select c.minimum_clearance into required from public.lv_cameras c where c.id=camera and c.workspace_id=new.workspace_id; end if;
 module_name:=case when new.observation_id is not null or to_jsonb(new)->>'event_id' is not null then 'analytics' else 'monitor' end;
 if required is null or not public.lv_staff_can_write(new.workspace_id,module_name,required) then raise exception 'Alert creation is not permitted for this account'; end if;
 return new;
end $$;
revoke all on function public.lv_guard_alert_insert() from public,anon,authenticated;
create trigger lv_alert_insert_guard before insert on public.lv_agency_alerts for each row execute function public.lv_guard_alert_insert();

create function public.lv_guard_corrective_access() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; parent public.lv_records;
begin
 if auth.uid() is null then if tg_op='DELETE' then return old; else return new; end if; end if;
 item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 select * into parent from public.lv_records where id=(item->>'incident_id')::uuid;
 if parent.id is null or not public.lv_staff_can_write(parent.workspace_id,'records',parent.minimum_clearance)
 then raise exception 'Corrective action access is not permitted'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.lv_guard_corrective_access() from public,anon,authenticated;
create trigger lv_corrective_access_guard before insert or update or delete on public.lv_corrective_actions for each row execute function public.lv_guard_corrective_access();
create policy lv_operational_upload_permissions on storage.objects as restrictive for insert to authenticated with check(
 bucket_id not in ('lv-agency-evidence','lv-intel-snapshots') or exists(select 1 from public.lv_workspaces w
 where w.id::text=split_part(storage.objects.name,'/',1) and public.lv_staff_can_write(w.id,case when bucket_id='lv-agency-evidence' then 'evidence' else 'analytics' end))
);
commit;
