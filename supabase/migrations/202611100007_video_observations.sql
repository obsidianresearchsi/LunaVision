begin;
create table public.lv_video_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  camera_id uuid references public.lv_cameras on delete set null,
  source text not null check (source in ('camera','file')),
  frame_seconds numeric(12,2) not null check (frame_seconds between 0 and 315360000),
  summary text not null check (length(btrim(summary)) between 1 and 1500),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
create index lv_video_observations_recent on public.lv_video_observations(workspace_id, created_at desc, id desc);
alter table public.lv_video_observations enable row level security;
revoke all on public.lv_video_observations from public, anon, authenticated;
grant select on public.lv_video_observations to authenticated;
grant insert(workspace_id,camera_id,source,frame_seconds,summary) on public.lv_video_observations to authenticated;
create policy lv_video_observations_read on public.lv_video_observations for select to authenticated
  using (public.lv_workspace_active(workspace_id));
create policy lv_video_observations_insert on public.lv_video_observations for insert to authenticated
  with check (
    public.lv_workspace_active(workspace_id)
    and (
      (source='file' and camera_id is null)
      or (source='camera' and exists (
        select 1 from public.lv_cameras c
        where c.id=lv_video_observations.camera_id and c.workspace_id=lv_video_observations.workspace_id
      ))
    )
  );
commit;
