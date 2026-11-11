-- Step 05/17: 202611100005_vehicle_watchlist.sql
begin;

create table public.lv_vehicle_watchlist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  plate text not null check (plate collate "C" ~ '^[A-Z0-9]{2,12}$'),
  reason text not null check (reason in ('stolen', 'watchlist')),
  case_reference text not null check (length(btrim(case_reference)) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  retired_at timestamptz,
  retired_by uuid
);

create unique index lv_vehicle_watchlist_active_plate
  on public.lv_vehicle_watchlist(workspace_id, plate) where retired_at is null;
create index lv_vehicle_watchlist_workspace_date
  on public.lv_vehicle_watchlist(workspace_id, created_at desc);

alter table public.lv_vehicle_watchlist enable row level security;
revoke all on public.lv_vehicle_watchlist from public, anon, authenticated;
grant select on public.lv_vehicle_watchlist to authenticated;
grant insert(workspace_id, plate, reason, case_reference) on public.lv_vehicle_watchlist to authenticated;

create policy lv_vehicle_watchlist_read on public.lv_vehicle_watchlist for select to authenticated using (
  exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = lv_vehicle_watchlist.workspace_id and m.user_id = (select auth.uid()) and w.kind = 'agency'
  )
);

create policy lv_vehicle_watchlist_add on public.lv_vehicle_watchlist for insert to authenticated with check (
  exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = lv_vehicle_watchlist.workspace_id and m.user_id = (select auth.uid()) and w.kind = 'agency'
  )
);

create function public.lv_retire_vehicle_watch(target_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.lv_vehicle_watchlist v set retired_at = now(), retired_by = auth.uid()
  where v.id = target_id and v.retired_at is null and exists (
    select 1 from public.lv_memberships m join public.lv_workspaces w on w.id = m.workspace_id
    where m.workspace_id = v.workspace_id and m.user_id = auth.uid() and w.kind = 'agency'
  );
  if not found then raise exception 'Active watchlist entry unavailable'; end if;
end $$;

revoke all on function public.lv_retire_vehicle_watch(uuid) from public, anon, authenticated;
grant execute on function public.lv_retire_vehicle_watch(uuid) to authenticated;

commit;
