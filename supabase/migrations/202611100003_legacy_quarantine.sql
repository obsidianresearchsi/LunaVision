begin;

-- Retain the original rows for a controlled archive or migration.
revoke all privileges on table
  public.audit_logs, public.cameras, public.case_activities,
  public.case_linked_searches, public.case_linked_subjects, public.case_notes,
  public.cases, public.detections, public.notifications, public.settings,
  public.surveillance_alerts, public.suspects, public.users, public.watchlist
from public, anon, authenticated;

update storage.buckets set public = false where id = 'mugshots';

create policy lv_legacy_mugshots_block
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'mugshots')
  with check (bucket_id <> 'mugshots');

commit;
