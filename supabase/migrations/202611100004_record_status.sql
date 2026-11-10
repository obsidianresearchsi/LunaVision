begin;

alter table public.lv_records add column status text not null default 'open'
  check (status in ('open','in_review','resolved'));

create table public.lv_record_activity (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.lv_records on delete cascade,
  actor_id uuid references auth.users on delete set null,
  previous_status text not null,
  next_status text not null,
  created_at timestamptz not null default now()
);
create index lv_record_activity_record on public.lv_record_activity(record_id, created_at desc);
alter table public.lv_record_activity enable row level security;
revoke all on public.lv_record_activity from public, anon, authenticated;
grant select on public.lv_record_activity to authenticated;
create policy lv_record_activity_read on public.lv_record_activity for select to authenticated using (
  exists (select 1 from public.lv_records r where r.id = record_id)
);

create function public.lv_change_record_status(target_id uuid, expected_status text, new_status text)
returns public.lv_records language plpgsql security definer set search_path='' as $$
declare current_record public.lv_records; actor uuid := auth.uid();
begin
  select r.* into current_record from public.lv_records r
    join public.lv_memberships m on m.workspace_id=r.workspace_id and m.user_id=actor
    where r.id=target_id and r.category in ('incident','investigation')
    for update of r;
  if not found then raise exception 'Record is unavailable'; end if;
  if current_record.status is distinct from expected_status then
    raise exception 'Record changed. Refresh before retrying';
  end if;
  if not coalesce(
    (expected_status='open' and new_status='in_review')
    or (expected_status='in_review' and new_status in ('open','resolved'))
    or (expected_status='resolved' and new_status='open'), false
  ) then raise exception 'Invalid status transition'; end if;
  update public.lv_records set status=new_status where id=target_id returning * into current_record;
  insert into public.lv_record_activity(record_id,actor_id,previous_status,next_status)
    values(target_id,actor,expected_status,new_status);
  return current_record;
end $$;
revoke all on function public.lv_change_record_status(uuid,text,text) from public, anon, authenticated;
grant execute on function public.lv_change_record_status(uuid,text,text) to authenticated;
commit;
