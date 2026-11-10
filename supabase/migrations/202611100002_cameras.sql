begin;
create table public.lv_cameras (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.lv_workspaces on delete cascade,
 name text not null check(length(trim(name)) between 2 and 100),
 location text not null default '' check(length(location)<=200),
 playback_url text not null check (
   length(playback_url)<=2048 and
   playback_url ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?/[^[:space:]?#]*$'
 ),
 created_at timestamptz not null default now()
);
create index lv_cameras_workspace on public.lv_cameras(workspace_id);
alter table public.lv_cameras enable row level security;
revoke all on public.lv_cameras from public, anon, authenticated;
grant select on public.lv_cameras to authenticated;
grant insert(workspace_id,name,location,playback_url) on public.lv_cameras to authenticated;
create policy lv_cameras_read on public.lv_cameras for select to authenticated using (
 exists(select 1 from public.lv_memberships m
 where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()))
);
create policy lv_cameras_insert on public.lv_cameras for insert to authenticated with check (
 exists(select 1 from public.lv_memberships m
 where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()) and m.role='owner')
 or (
 exists(select 1 from public.lv_memberships m where m.workspace_id=lv_cameras.workspace_id and m.user_id=(select auth.uid()))
 and exists(select 1 from public.lv_platform_admins a where a.user_id=(select auth.uid()))
 )
);
commit;
