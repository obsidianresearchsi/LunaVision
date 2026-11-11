-- Step 03/17: 202611100003_legacy_quarantine.sql
begin;

-- Guarded wrapper so this step succeeds cleanly on both a brand-new empty
-- database (where legacy EagleEye v1 tables do not exist) and an upgraded DB.
do $$
declare
  tbl text;
  legacy_tables text[] := array[
    'audit_logs', 'cameras', 'case_activities',
    'case_linked_searches', 'case_linked_subjects', 'case_notes',
    'cases', 'detections', 'notifications', 'settings',
    'surveillance_alerts', 'suspects', 'users', 'watchlist'
  ];
begin
  foreach tbl in array legacy_tables loop
    if to_regclass('public.' || tbl) is not null then
      execute format('revoke all privileges on table public.%I from public, anon, authenticated', tbl);
    end if;
  end loop;
end $$;

update storage.buckets set public = false where id = 'mugshots';

drop policy if exists lv_legacy_mugshots_block on storage.objects;
create policy lv_legacy_mugshots_block
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'mugshots')
  with check (bucket_id <> 'mugshots');

commit;
