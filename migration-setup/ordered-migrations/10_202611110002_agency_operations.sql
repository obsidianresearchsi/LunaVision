-- Step 10/17: 202611110002_agency_operations.sql
begin;

create function public.lv_agency_member(target uuid, manager boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.lv_workspaces w join public.lv_memberships m on m.workspace_id=w.id
    where w.id=target and w.kind='agency' and w.active and m.user_id=auth.uid()
    and (not manager or m.role in ('owner','admin')))
$$;
revoke all on function public.lv_agency_member(uuid,boolean) from public,anon,authenticated;
grant execute on function public.lv_agency_member(uuid,boolean) to authenticated;

create table public.lv_agency_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  name text not null check(length(btrim(name)) between 2 and 100),
  object_label text not null check(object_label in ('car','truck','bus','motorcycle','bicycle','boat','airplane','train','fire hydrant','backpack','suitcase')),
  minimum_confidence numeric not null check(minimum_confidence between 0.5 and 1),
  severity text not null check(severity in ('low','medium','high')),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.lv_agency_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  title text not null check(length(btrim(title)) between 2 and 140),
  details text not null default '' check(length(details)<=4000),
  severity text not null check(severity in ('low','medium','high')),
  status text not null default 'open' check(status in ('open','acknowledged','resolved')),
  observation_id uuid references public.lv_video_observations,
  rule_id uuid references public.lv_agency_rules,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(observation_id,rule_id)
);
create table public.lv_agency_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces,
  record_id uuid not null references public.lv_records,
  title text not null check(length(btrim(title)) between 2 and 140),
  notes text not null default '' check(length(notes)<=4000),
  storage_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 240),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf','video/mp4')),
  byte_size integer not null check(byte_size between 1 and 26214400),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index lv_agency_alerts_recent on public.lv_agency_alerts(workspace_id,created_at desc,id desc);
create index lv_agency_evidence_recent on public.lv_agency_evidence(workspace_id,created_at desc,id desc);
create index lv_agency_rules_workspace on public.lv_agency_rules(workspace_id);

alter table public.lv_agency_rules enable row level security;
alter table public.lv_agency_alerts enable row level security;
alter table public.lv_agency_evidence enable row level security;
revoke all on public.lv_agency_rules,public.lv_agency_alerts,public.lv_agency_evidence from public,anon,authenticated;
grant select on public.lv_agency_rules,public.lv_agency_alerts,public.lv_agency_evidence to authenticated;
grant insert(workspace_id,name,object_label,minimum_confidence,severity,enabled) on public.lv_agency_rules to authenticated;
grant update(name,minimum_confidence,severity,enabled) on public.lv_agency_rules to authenticated;
grant insert(workspace_id,title,details,severity) on public.lv_agency_alerts to authenticated;
grant insert(workspace_id,record_id,title,notes,storage_path,file_name,mime_type,byte_size,sha256) on public.lv_agency_evidence to authenticated;
create policy lv_rules_read on public.lv_agency_rules for select to authenticated using(public.lv_agency_member(workspace_id));
create policy lv_rules_insert on public.lv_agency_rules for insert to authenticated with check(public.lv_agency_member(workspace_id,true));
create policy lv_rules_update on public.lv_agency_rules for update to authenticated using(public.lv_agency_member(workspace_id,true));
create policy lv_alerts_read on public.lv_agency_alerts for select to authenticated using(public.lv_agency_member(workspace_id));
create policy lv_alerts_insert on public.lv_agency_alerts for insert to authenticated with check(public.lv_agency_member(workspace_id));
create policy lv_evidence_read on public.lv_agency_evidence for select to authenticated using(public.lv_agency_member(workspace_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-agency-evidence','lv-agency-evidence',false,26214400,array['image/jpeg','image/png','application/pdf','video/mp4']);
create policy lv_evidence_objects_read on storage.objects for select to authenticated using(
  bucket_id='lv-agency-evidence' and (
    exists(select 1 from public.lv_agency_evidence e where e.storage_path=storage.objects.name and public.lv_agency_member(e.workspace_id))
    or ((storage.foldername(storage.objects.name))[2]=auth.uid()::text and exists(select 1 from public.lv_workspaces w
      where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)))
  )
);
create policy lv_evidence_objects_upload on storage.objects for insert to authenticated with check(
  bucket_id='lv-agency-evidence' and (storage.foldername(storage.objects.name))[2]=auth.uid()::text
  and exists(select 1 from public.lv_workspaces w where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
create policy lv_evidence_objects_cleanup on storage.objects for delete to authenticated using(
  bucket_id='lv-agency-evidence' and (storage.foldername(storage.objects.name))[2]=auth.uid()::text
  and not exists(select 1 from public.lv_agency_evidence e where e.storage_path=storage.objects.name)
  and exists(select 1 from public.lv_workspaces w where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
-- Security-definer validation can inspect the newly uploaded object before it has an evidence row.
create function public.lv_valid_evidence(target uuid, case_id uuid, path text, bytes integer, mime text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.lv_agency_member(target) and exists(select 1 from public.lv_records r
   where r.id=case_id and r.workspace_id=target and r.category='investigation')
 and split_part(path,'/',1)=target::text and split_part(path,'/',2)=auth.uid()::text
 and exists(select 1 from storage.objects o where o.bucket_id='lv-agency-evidence' and o.name=path
   and (o.metadata->>'size')::bigint=bytes and o.metadata->>'mimetype'=mime)
$$;
revoke all on function public.lv_valid_evidence(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.lv_valid_evidence(uuid,uuid,text,integer,text) to authenticated;
create policy lv_evidence_insert on public.lv_agency_evidence for insert to authenticated with check(
  public.lv_valid_evidence(workspace_id,record_id,storage_path,byte_size,mime_type)
);

create function public.lv_agency_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.lv_workspace_activity(workspace_id,actor_id,subject_id,action)
 values(new.workspace_id,auth.uid(),new.id,tg_table_name||'.'||lower(tg_op));
 return new;
end $$;
revoke all on function public.lv_agency_audit() from public,anon,authenticated;
create trigger lv_rules_audit after insert or update on public.lv_agency_rules for each row execute function public.lv_agency_audit();
create trigger lv_alerts_audit after insert or update on public.lv_agency_alerts for each row execute function public.lv_agency_audit();
create trigger lv_evidence_audit after insert on public.lv_agency_evidence for each row execute function public.lv_agency_audit();

create function public.lv_transition_alert(target uuid, expected text, next_status text) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_alerts;
begin
 select * into item from public.lv_agency_alerts where id=target for update;
 if item.id is null or not public.lv_agency_member(item.workspace_id) then raise exception 'Alert unavailable'; end if;
 if item.status<>expected then raise exception 'Alert changed. Refresh and retry.'; end if;
 if next_status is null or not ((expected='open' and next_status='acknowledged')
   or (expected='acknowledged' and next_status='resolved') or (expected='resolved' and next_status='open'))
   then raise exception 'Invalid alert transition'; end if;
 update public.lv_agency_alerts set status=next_status,updated_at=now() where id=target;
end $$;
revoke all on function public.lv_transition_alert(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lv_transition_alert(uuid,text,text) to authenticated;

alter table public.lv_video_observations add column detections jsonb not null default '[]'::jsonb;
grant insert(detections) on public.lv_video_observations to authenticated;
create function public.lv_observation_rules() returns trigger language plpgsql security definer set search_path='' as $$
declare detection jsonb;
begin
 if jsonb_typeof(new.detections)<>'array' or jsonb_array_length(new.detections)>100 then raise exception 'Invalid detections'; end if;
 for detection in select value from jsonb_array_elements(new.detections) loop
   if jsonb_typeof(detection->'label') is distinct from 'string'
     or jsonb_typeof(detection->'score') is distinct from 'number'
     or length(detection->>'label')>80 or (detection->>'score')::numeric not between 0 and 1
     then raise exception 'Invalid detection'; end if;
 end loop;
 if public.lv_agency_member(new.workspace_id) then
   insert into public.lv_agency_alerts(workspace_id,title,details,severity,observation_id,rule_id,created_by)
   select new.workspace_id,r.name,'Saved observation: '||new.summary,r.severity,new.id,r.id,new.created_by
   from public.lv_agency_rules r where r.workspace_id=new.workspace_id and r.enabled and exists(
     select 1 from jsonb_array_elements(new.detections) d where d->>'label'=r.object_label
     and (d->>'score')::numeric>=r.minimum_confidence);
 end if;
 return new;
end $$;
revoke all on function public.lv_observation_rules() from public,anon,authenticated;
create trigger lv_observation_rule_evaluation after insert on public.lv_video_observations for each row execute function public.lv_observation_rules();

grant update(name,location,playback_url) on public.lv_cameras to authenticated;
-- Existing map-update policy restricts agency camera updates to managers.
commit;
