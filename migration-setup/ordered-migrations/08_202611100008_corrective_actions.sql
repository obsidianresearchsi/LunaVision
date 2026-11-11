-- Step 08/17: 202611100008_corrective_actions.sql
begin;
create table public.lv_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.lv_records on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 160),
  responsible_team text not null check (length(btrim(responsible_team)) between 1 and 100),
  due_on date not null check (isfinite(due_on)),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  completed_at timestamptz,
  completed_by uuid
);
create index lv_corrective_actions_incident on public.lv_corrective_actions(incident_id, due_on, id);
alter table public.lv_corrective_actions enable row level security;
revoke all on public.lv_corrective_actions from public,anon,authenticated;
grant select on public.lv_corrective_actions to authenticated;
grant insert(incident_id,title,responsible_team,due_on) on public.lv_corrective_actions to authenticated;
create policy lv_corrective_actions_read on public.lv_corrective_actions for select to authenticated using (
  exists (select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=incident_id and r.category='incident' and w.kind='business')
);
create policy lv_corrective_actions_add on public.lv_corrective_actions for insert to authenticated with check (
  exists (select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=incident_id and r.category='incident' and w.kind='business')
);
create function public.lv_complete_corrective_action(target uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.lv_corrective_actions a set completed_at=now(),completed_by=auth.uid()
  where a.id=target and a.completed_at is null and exists (
    select 1 from public.lv_records r join public.lv_workspaces w on w.id=r.workspace_id
    where r.id=a.incident_id and r.category='incident' and w.kind='business'
      and public.lv_workspace_active(w.id)
  );
  if not found then raise exception 'Open corrective action unavailable'; end if;
end $$;
revoke all on function public.lv_complete_corrective_action(uuid) from public,anon,authenticated;
grant execute on function public.lv_complete_corrective_action(uuid) to authenticated;
commit;
