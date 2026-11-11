-- Step 14/17: 202611120003_enterprise_enrollment_migration.sql
begin;

-- ---------------------------------------------------------------------------
-- 1. Feature governance extensions (Biometric Enrollment & 1:N Face Search)
-- ---------------------------------------------------------------------------
alter table public.lv_workspace_features drop constraint if exists lv_workspace_features_feature_check;
alter table public.lv_workspace_features add constraint lv_workspace_features_feature_check
  check (feature in (
    'people_analytics','vehicle_analytics','advanced_detection',
    'anpr','vehicle_registry','security_intelligence','business_intelligence',
    'biometric_enrollment','face_search'
  ));

do $$ begin
  if to_regprocedure('public.lv_has_scope(uuid,text,integer)') is null then
    execute $fn$
      create or replace function public.lv_feature_enabled(target uuid, feature_name text) returns boolean
      language sql stable security definer set search_path='' as $body$
        select coalesce(
          (select f.enabled from public.lv_workspace_features f where f.workspace_id=target and f.feature=feature_name),
          (select case w.kind
              when 'agency' then feature_name <> 'business_intelligence'
              when 'business' then feature_name in ('people_analytics','vehicle_analytics','advanced_detection','business_intelligence')
              else false end
           from public.lv_workspaces w where w.id=target),
          false)
      $body$;
    $fn$;
  end if;
end $$;

create or replace function public.lv_workspace_feature_map(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f text; result jsonb := '{}'::jsonb;
begin
  if not (public.lv_workspace_active(target) or exists(select 1 from public.lv_platform_admins a where a.user_id=auth.uid())) then
    raise exception 'Workspace unavailable';
  end if;
  foreach f in array array[
    'people_analytics','vehicle_analytics','advanced_detection',
    'anpr','vehicle_registry','security_intelligence','business_intelligence',
    'biometric_enrollment','face_search'
  ] loop
    result := result || jsonb_build_object(f, public.lv_feature_enabled(target, f));
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Enterprise Subject Migration Jobs & Authorized Subject Dossiers
-- ---------------------------------------------------------------------------
create table if not exists public.lv_subject_migrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  source_name text not null check (length(btrim(source_name)) between 1 and 120),
  file_name text not null default '' check (length(file_name) <= 240),
  total_records integer not null default 0,
  processed_records integer not null default 0,
  indexed_faces integer not null default 0,
  skipped_duplicates integer not null default 0,
  failed_records integer not null default 0,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','cancelled','failed')),
  errors jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid(),
  created_by_label text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists lv_subject_migrations_recent on public.lv_subject_migrations(workspace_id, created_at desc);

create table if not exists public.lv_agency_subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  subject_code text check (subject_code is null or length(btrim(subject_code)) between 1 and 80),
  full_name text not null check (length(btrim(full_name)) between 1 and 140),
  aliases text not null default '' check (length(aliases) <= 300),
  date_of_birth text not null default '' check (length(date_of_birth) <= 40),
  gender text not null default '' check (length(gender) <= 40),
  nationality text not null default '' check (length(nationality) <= 80),
  category text not null default 'suspect' check (category in ('wanted','suspect','person_of_interest','missing','authorized','other')),
  threat_level text not null default 'medium' check (threat_level in ('low','medium','high','critical')),
  offense_summary text not null default '' check (length(offense_summary) <= 2000),
  warrant_reference text not null default '' check (length(warrant_reference) <= 120),
  case_reference text not null default '' check (length(case_reference) <= 120),
  national_id text not null default '' check (length(national_id) <= 80),
  last_known_location text not null default '' check (length(last_known_location) <= 240),
  physical_marks text not null default '' check (length(physical_marks) <= 1000),
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'active' check (status in ('active','resolved','archived')),
  minimum_clearance integer not null default 0 check (minimum_clearance between 0 and 3),
  primary_photo_path text check (primary_photo_path is null or length(primary_photo_path) <= 300),
  face_token text check (face_token is null or face_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  face_indexed boolean not null default false,
  faceset_outer_id text not null default '' check (length(faceset_outer_id) <= 120),
  source_name text not null default 'manual' check (length(source_name) <= 120),
  migration_id uuid references public.lv_subject_migrations on delete set null,
  revision bigint not null default 1,
  created_by uuid not null default auth.uid(),
  created_by_label text not null default '',
  updated_by uuid,
  updated_by_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lv_agency_subjects_code on public.lv_agency_subjects(workspace_id, subject_code)
  where subject_code is not null;
create index if not exists lv_agency_subjects_token on public.lv_agency_subjects(workspace_id, face_token)
  where face_token is not null;
create index if not exists lv_agency_subjects_recent on public.lv_agency_subjects(workspace_id, status, created_at desc);

create table if not exists public.lv_subject_photos (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.lv_agency_subjects on delete cascade,
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  storage_path text not null check (length(storage_path) <= 300),
  face_token text check (face_token is null or face_token ~ '^[A-Za-z0-9_-]{8,128}$'),
  face_indexed boolean not null default false,
  angle_label text not null default 'frontal' check (angle_label in ('frontal','left_profile','right_profile','surveillance_still','id_document','other')),
  quality_score numeric,
  is_primary boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lv_subject_photos_subject on public.lv_subject_photos(subject_id, is_primary desc, created_at asc);
create index if not exists lv_subject_photos_token on public.lv_subject_photos(workspace_id, face_token)
  where face_token is not null;

create table if not exists public.lv_face_search_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lv_workspaces on delete cascade,
  actor_id uuid not null default auth.uid(),
  actor_label text not null default '',
  search_mode text not null check (search_mode in ('faceset_1n','gallery_1v6','pair_1v1')),
  probe_snapshot_path text check (probe_snapshot_path is null or length(probe_snapshot_path) <= 300),
  top_confidence numeric check (top_confidence is null or top_confidence between 0 and 100),
  result_count integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  telemetry jsonb not null default '{}'::jsonb,
  case_reference text not null default '' check (length(case_reference) <= 120),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists lv_face_search_history_recent on public.lv_face_search_history(workspace_id, created_at desc);

alter table public.lv_subject_migrations enable row level security;
alter table public.lv_agency_subjects enable row level security;
alter table public.lv_subject_photos enable row level security;
alter table public.lv_face_search_history enable row level security;

revoke all on public.lv_subject_migrations, public.lv_agency_subjects, public.lv_subject_photos, public.lv_face_search_history
  from public, anon, authenticated;
grant select on public.lv_subject_migrations, public.lv_agency_subjects, public.lv_subject_photos, public.lv_face_search_history
  to authenticated;

create or replace function public.lv_subject_clearance_ok(target uuid, required_clearance integer default 0) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.lv_memberships m
    where m.workspace_id = target and m.user_id = auth.uid()
      and coalesce(to_jsonb(m)->>'clearance', '3')::integer >= coalesce(required_clearance, 0)
  )
$$;
revoke all on function public.lv_subject_clearance_ok(uuid, integer) from public, anon, authenticated;
grant execute on function public.lv_subject_clearance_ok(uuid, integer) to authenticated;

drop policy if exists lv_subject_migrations_read on public.lv_subject_migrations;
create policy lv_subject_migrations_read on public.lv_subject_migrations for select to authenticated using (
  public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id, 'biometric_enrollment')
);
drop policy if exists lv_agency_subjects_read on public.lv_agency_subjects;
create policy lv_agency_subjects_read on public.lv_agency_subjects for select to authenticated using (
  public.lv_agency_member(workspace_id)
  and (public.lv_feature_enabled(workspace_id, 'biometric_enrollment') or public.lv_feature_enabled(workspace_id, 'face_search'))
  and public.lv_subject_clearance_ok(workspace_id, minimum_clearance)
);
drop policy if exists lv_subject_photos_read on public.lv_subject_photos;
create policy lv_subject_photos_read on public.lv_subject_photos for select to authenticated using (
  exists (
    select 1 from public.lv_agency_subjects s
    where s.id = lv_subject_photos.subject_id and s.workspace_id = lv_subject_photos.workspace_id
      and public.lv_agency_member(s.workspace_id)
      and public.lv_subject_clearance_ok(s.workspace_id, s.minimum_clearance)
  )
);
drop policy if exists lv_face_search_history_read on public.lv_face_search_history;
create policy lv_face_search_history_read on public.lv_face_search_history for select to authenticated using (
  public.lv_agency_member(workspace_id) and public.lv_feature_enabled(workspace_id, 'face_search')
);

-- ---------------------------------------------------------------------------
-- 3. Subject Enrollment, Migration & Search History RPCs
-- ---------------------------------------------------------------------------
create or replace function public.lv_upsert_agency_subject(target uuid, entry jsonb, photos jsonb default '[]'::jsonb)
returns public.lv_agency_subjects
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  actor_email text;
  claims jsonb;
  sid uuid;
  scode text;
  existing public.lv_agency_subjects;
  saved public.lv_agency_subjects;
  ph jsonb;
  primary_path text;
  primary_token text;
  any_indexed boolean := false;
  actor_clearance integer;
  req_clearance integer;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'biometric_enrollment') then
    raise exception 'Subject enrollment unavailable';
  end if;

  select coalesce(to_jsonb(m)->>'clearance', '3')::integer into actor_clearance
    from public.lv_memberships m where m.workspace_id=target and m.user_id=actor;
  req_clearance := greatest(0, least(3, coalesce(nullif(entry->>'minimum_clearance','')::integer, 0)));
  if req_clearance > coalesce(actor_clearance, 3) then
    raise exception 'Cannot assign clearance higher than your own';
  end if;

  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');

  sid := nullif(entry->>'id', '')::uuid;
  scode := nullif(btrim(coalesce(entry->>'subject_code', '')), '');

  if sid is not null then
    select * into existing from public.lv_agency_subjects where id=sid and workspace_id=target for update;
    if existing.id is null then raise exception 'Subject record not found'; end if;
  elsif scode is not null then
    select * into existing from public.lv_agency_subjects where workspace_id=target and subject_code=scode for update;
  end if;

  if jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0 then
    for ph in select value from jsonb_array_elements(photos) loop
      if coalesce((ph->>'is_primary')::boolean, false) or primary_path is null then
        primary_path := nullif(ph->>'storage_path', '');
        primary_token := nullif(ph->>'face_token', '');
      end if;
      if coalesce((ph->>'face_indexed')::boolean, false) then any_indexed := true; end if;
    end loop;
  end if;

  primary_path := coalesce(primary_path, nullif(entry->>'primary_photo_path', ''), existing.primary_photo_path);
  if primary_path is not null and (primary_path not like target::text || '/%' or primary_path like '%..%') then
    raise exception 'Invalid photo storage path';
  end if;
  primary_token := coalesce(primary_token, nullif(entry->>'face_token', ''), existing.face_token);
  any_indexed := any_indexed or coalesce((entry->>'face_indexed')::boolean, false) or coalesce(existing.face_indexed, false);

  if existing.id is null then
    insert into public.lv_agency_subjects(
      workspace_id, subject_code, full_name, aliases, date_of_birth, gender, nationality,
      category, threat_level, offense_summary, warrant_reference, case_reference, national_id,
      last_known_location, physical_marks, notes, status, minimum_clearance,
      primary_photo_path, face_token, face_indexed, faceset_outer_id, source_name, migration_id,
      created_by, created_by_label
    ) values (
      target, scode, btrim(entry->>'full_name'),
      left(btrim(coalesce(entry->>'aliases','')), 300),
      left(btrim(coalesce(entry->>'date_of_birth','')), 40),
      left(btrim(coalesce(entry->>'gender','')), 40),
      left(btrim(coalesce(entry->>'nationality','')), 80),
      coalesce(nullif(entry->>'category',''), 'suspect'),
      coalesce(nullif(entry->>'threat_level',''), 'medium'),
      left(btrim(coalesce(entry->>'offense_summary','')), 2000),
      left(btrim(coalesce(entry->>'warrant_reference','')), 120),
      left(btrim(coalesce(entry->>'case_reference','')), 120),
      left(btrim(coalesce(entry->>'national_id','')), 80),
      left(btrim(coalesce(entry->>'last_known_location','')), 240),
      left(btrim(coalesce(entry->>'physical_marks','')), 1000),
      left(btrim(coalesce(entry->>'notes','')), 4000),
      coalesce(nullif(entry->>'status',''), 'active'),
      req_clearance,
      primary_path, primary_token, any_indexed,
      left(coalesce(entry->>'faceset_outer_id', 'lv_' || replace(target::text, '-', '')), 120),
      left(coalesce(nullif(btrim(entry->>'source_name'),''), 'manual'), 120),
      nullif(entry->>'migration_id','')::uuid,
      actor, actor_email
    ) returning * into saved;

    insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
      values(target, actor, saved.id, 'subject.enrolled');
  else
    update public.lv_agency_subjects set
      subject_code = coalesce(scode, subject_code),
      full_name = coalesce(nullif(btrim(entry->>'full_name'),''), full_name),
      aliases = coalesce(nullif(left(btrim(coalesce(entry->>'aliases','')), 300),''), aliases),
      date_of_birth = coalesce(nullif(left(btrim(coalesce(entry->>'date_of_birth','')), 40),''), date_of_birth),
      gender = coalesce(nullif(left(btrim(coalesce(entry->>'gender','')), 40),''), gender),
      nationality = coalesce(nullif(left(btrim(coalesce(entry->>'nationality','')), 80),''), nationality),
      category = coalesce(nullif(entry->>'category',''), category),
      threat_level = coalesce(nullif(entry->>'threat_level',''), threat_level),
      offense_summary = coalesce(nullif(left(btrim(coalesce(entry->>'offense_summary','')), 2000),''), offense_summary),
      warrant_reference = coalesce(nullif(left(btrim(coalesce(entry->>'warrant_reference','')), 120),''), warrant_reference),
      case_reference = coalesce(nullif(left(btrim(coalesce(entry->>'case_reference','')), 120),''), case_reference),
      national_id = coalesce(nullif(left(btrim(coalesce(entry->>'national_id','')), 80),''), national_id),
      last_known_location = coalesce(nullif(left(btrim(coalesce(entry->>'last_known_location','')), 240),''), last_known_location),
      physical_marks = coalesce(nullif(left(btrim(coalesce(entry->>'physical_marks','')), 1000),''), physical_marks),
      notes = coalesce(nullif(left(btrim(coalesce(entry->>'notes','')), 4000),''), notes),
      status = coalesce(nullif(entry->>'status',''), status),
      minimum_clearance = req_clearance,
      primary_photo_path = coalesce(primary_path, primary_photo_path),
      face_token = coalesce(primary_token, face_token),
      face_indexed = any_indexed,
      faceset_outer_id = coalesce(nullif(entry->>'faceset_outer_id',''), faceset_outer_id),
      source_name = coalesce(nullif(btrim(entry->>'source_name'),''), source_name),
      migration_id = coalesce(nullif(entry->>'migration_id','')::uuid, migration_id),
      revision = revision + 1,
      updated_at = now(),
      updated_by = actor,
      updated_by_label = actor_email
    where id = existing.id returning * into saved;

    insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
      values(target, actor, saved.id, 'subject.updated');
  end if;

  if jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) > 0 then
    for ph in select value from jsonb_array_elements(photos) loop
      if nullif(ph->>'storage_path','') is not null then
        if (ph->>'storage_path') not like target::text || '/%' or (ph->>'storage_path') like '%..%' then
          raise exception 'Invalid photo storage path';
        end if;
        insert into public.lv_subject_photos(
          subject_id, workspace_id, storage_path, face_token, face_indexed, angle_label, quality_score, is_primary, created_by
        ) values (
          saved.id, target, ph->>'storage_path', nullif(ph->>'face_token',''),
          coalesce((ph->>'face_indexed')::boolean, false),
          coalesce(nullif(ph->>'angle_label',''), 'frontal'),
          nullif(ph->>'quality_score','')::numeric,
          coalesce((ph->>'is_primary')::boolean, false),
          actor
        );
      end if;
    end loop;
  end if;

  return saved;
end $$;
revoke all on function public.lv_upsert_agency_subject(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lv_upsert_agency_subject(uuid,jsonb,jsonb) to authenticated;

create or replace function public.lv_start_subject_migration(target uuid, source_label text, filename text, total integer)
returns uuid
language plpgsql security definer set search_path='' as $$
declare mid uuid; claims jsonb; actor_email text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'biometric_enrollment') then
    raise exception 'Subject migration unavailable';
  end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');
  insert into public.lv_subject_migrations(workspace_id, source_name, file_name, total_records, created_by, created_by_label)
    values(target, left(btrim(source_label), 120), left(coalesce(filename,''), 240), greatest(1, total), auth.uid(), actor_email)
    returning id into mid;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
    values(target, auth.uid(), mid, 'subject.migration_started');
  return mid;
end $$;
revoke all on function public.lv_start_subject_migration(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.lv_start_subject_migration(uuid,text,text,integer) to authenticated;

create or replace function public.lv_update_subject_migration(target_migration uuid, processed integer, indexed integer, duplicates integer, failed integer, next_status text, err_list jsonb default '[]'::jsonb)
returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_subject_migrations;
begin
  select * into item from public.lv_subject_migrations where id=target_migration for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_write') then
    raise exception 'Migration job unavailable';
  end if;
  update public.lv_subject_migrations set
    processed_records = processed,
    indexed_faces = indexed,
    skipped_duplicates = duplicates,
    failed_records = failed,
    status = next_status,
    errors = err_list,
    completed_at = case when next_status in ('completed','completed_with_errors','cancelled','failed') then now() else completed_at end
  where id = target_migration;
end $$;
revoke all on function public.lv_update_subject_migration(uuid,integer,integer,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.lv_update_subject_migration(uuid,integer,integer,integer,integer,text,jsonb) to authenticated;

create or replace function public.lv_retire_agency_subject(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_subjects;
begin
  select * into item from public.lv_agency_subjects where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_archive') then
    raise exception 'Subject record unavailable';
  end if;
  update public.lv_agency_subjects set status='archived', updated_at=now(), updated_by=auth.uid(), revision=revision+1 where id=target_id;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action) values(item.workspace_id, auth.uid(), target_id, 'subject.archived');
end $$;
revoke all on function public.lv_retire_agency_subject(uuid) from public,anon,authenticated;
grant execute on function public.lv_retire_agency_subject(uuid) to authenticated;

create or replace function public.lv_delete_agency_subject(target_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item public.lv_agency_subjects;
begin
  select * into item from public.lv_agency_subjects where id=target_id for update;
  if item.id is null or not public.lv_agency_member(item.workspace_id) or not public.lv_workspace_permission(item.workspace_id, 'watchlist_delete') then
    raise exception 'Subject record unavailable';
  end if;
  delete from public.lv_agency_subjects where id=target_id;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action) values(item.workspace_id, auth.uid(), target_id, 'subject.deleted');
end $$;
revoke all on function public.lv_delete_agency_subject(uuid) from public,anon,authenticated;
grant execute on function public.lv_delete_agency_subject(uuid) to authenticated;

create or replace function public.lv_log_face_search(target uuid, mode text, probe_path text, confidence numeric, matches jsonb, telemetry jsonb default '{}'::jsonb, case_ref text default '', search_notes text default '')
returns uuid
language plpgsql security definer set search_path='' as $$
declare hid uuid; claims jsonb; actor_email text; n integer := 0;
begin
  if not public.lv_agency_member(target) or not public.lv_feature_enabled(target, 'face_search') then
    raise exception 'Face search unavailable';
  end if;
  if probe_path is not null and (probe_path not like target::text || '/%' or probe_path like '%..%') then
    raise exception 'Invalid probe snapshot path';
  end if;
  if jsonb_typeof(matches) = 'array' then n := jsonb_array_length(matches); end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');
  insert into public.lv_face_search_history(workspace_id, actor_id, actor_label, search_mode, probe_snapshot_path, top_confidence, result_count, results, telemetry, case_reference, notes)
    values(target, auth.uid(), actor_email, mode, probe_path, confidence, n, coalesce(matches,'[]'::jsonb), coalesce(telemetry,'{}'::jsonb), left(coalesce(case_ref,''),120), left(coalesce(search_notes,''),1000))
    returning id into hid;
  insert into public.lv_workspace_activity(workspace_id, actor_id, subject_id, action)
    values(target, auth.uid(), hid, 'face.search_' || mode);
  return hid;
end $$;
revoke all on function public.lv_log_face_search(uuid,text,text,numeric,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.lv_log_face_search(uuid,text,text,numeric,jsonb,jsonb,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bulk Plate Watchlist Migration RPC (supports large CSV/Excel + photo batches)
-- ---------------------------------------------------------------------------
create or replace function public.lv_import_watchlist(target uuid, source_name text, file_name text, entries jsonb, update_existing boolean default false)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r jsonb; ord integer := 0; p text; reason_val text; case_val text; st_val text; custom_cat text; photo_p text;
  existing public.lv_vehicle_watchlist;
  ins integer := 0; upd integer := 0; dup integer := 0; bad integer := 0; errs jsonb := '[]'::jsonb; seen text[] := '{}';
  claims jsonb; actor_email text;
begin
  if not public.lv_agency_member(target) or not public.lv_workspace_permission(target, 'watchlist_write')
    or not public.lv_feature_enabled(target, 'anpr') then
    raise exception 'Watchlist import unavailable';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 2000 then
    raise exception 'Import between 1 and 2000 rows per batch';
  end if;
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  actor_email := coalesce(nullif(claims->>'email', ''), 'Personnel');

  for r in select value from jsonb_array_elements(entries) loop
    ord := ord + 1;
    p := public.lv_normalize_plate(r->>'plate');
    if p !~ '^[A-Z0-9]{2,12}$' then
      bad := bad + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',coalesce(r->>'plate',''),'error','Plate must be 2 to 12 letters or digits')); end if;
      continue;
    end if;
    if p = any(seen) then
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Duplicate plate within batch')); end if;
      continue;
    end if;
    seen := seen || p;

    reason_val := lower(coalesce(nullif(btrim(r->>'category'),''), nullif(btrim(r->>'reason'),''), 'interest'));
    if reason_val not in ('stolen','wanted','interest','authorized','other','watchlist') then reason_val := 'other'; end if;
    custom_cat := case when reason_val='other' then coalesce(nullif(btrim(r->>'custom_category'),''), btrim(coalesce(r->>'category', r->>'reason', 'Migrated'))) else '' end;
    case_val := coalesce(nullif(btrim(r->>'case_reference'),''), nullif(btrim(source_name),''), 'MIGRATION');
    st_val := lower(coalesce(nullif(btrim(r->>'status'),''), 'active'));
    if st_val not in ('active','inactive','resolved') then st_val := 'active'; end if;
    photo_p := nullif(btrim(coalesce(r->>'photo_path','')), '');
    if photo_p is not null and (photo_p not like target::text || '/%' or photo_p like '%..%') then photo_p := null; end if;

    select * into existing from public.lv_vehicle_watchlist where workspace_id=target and plate=p and retired_at is null;
    if existing.id is null then
      insert into public.lv_vehicle_watchlist(
        workspace_id, plate, reason, custom_category, case_reference, make, model, colour,
        photo_path, description, notes, status, created_by, created_by_label
      ) values (
        target, p, reason_val, left(custom_cat,60), left(case_val,120),
        left(btrim(coalesce(r->>'make','')),60), left(btrim(coalesce(r->>'model','')),60), left(btrim(coalesce(r->>'colour','')),60),
        photo_p, left(btrim(coalesce(r->>'description','')),2000), left(btrim(coalesce(r->>'notes','')),4000),
        st_val, auth.uid(), actor_email
      );
      ins := ins + 1;
    elsif coalesce(update_existing, false) then
      update public.lv_vehicle_watchlist set
        reason = reason_val,
        custom_category = left(custom_cat,60),
        case_reference = left(case_val,120),
        make = coalesce(nullif(left(btrim(coalesce(r->>'make','')),60),''), make),
        model = coalesce(nullif(left(btrim(coalesce(r->>'model','')),60),''), model),
        colour = coalesce(nullif(left(btrim(coalesce(r->>'colour','')),60),''), colour),
        photo_path = coalesce(photo_p, photo_path),
        description = coalesce(nullif(left(btrim(coalesce(r->>'description','')),2000),''), description),
        notes = coalesce(nullif(left(btrim(coalesce(r->>'notes','')),4000),''), notes),
        status = st_val,
        revision = revision + 1,
        updated_at = now(),
        updated_by = auth.uid(),
        updated_by_label = actor_email
      where id = existing.id;
      upd := upd + 1;
    else
      dup := dup + 1;
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_array(jsonb_build_object('row',ord,'plate',p,'error','Active watchlist plate already exists')); end if;
    end if;
  end loop;

  insert into public.lv_workspace_activity(workspace_id, actor_id, action)
    values(target, auth.uid(), 'watchlist.migrated_' || left(coalesce(btrim(file_name),'batch'), 40));

  return jsonb_build_object('total',ord,'inserted',ins,'updated',upd,'duplicates',dup,'invalid',bad,'errors',errs);
end $$;
revoke all on function public.lv_import_watchlist(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.lv_import_watchlist(uuid,text,text,jsonb,boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Private Storage Bucket for Enrolled Subject Photos & Probe Snapshots
-- ---------------------------------------------------------------------------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lv-subject-photos','lv-subject-photos',false,4194304,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists lv_subject_photo_read on storage.objects;
create policy lv_subject_photo_read on storage.objects for select to authenticated using (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id))
);
drop policy if exists lv_subject_photo_upload on storage.objects;
create policy lv_subject_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and (public.lv_workspace_permission(w.id,'watchlist_write') or public.lv_feature_enabled(w.id,'face_search')))
);
drop policy if exists lv_subject_photo_delete on storage.objects;
create policy lv_subject_photo_delete on storage.objects for delete to authenticated using (
  bucket_id='lv-subject-photos' and exists(select 1 from public.lv_workspaces w
    where w.id::text=(storage.foldername(storage.objects.name))[1] and public.lv_agency_member(w.id)
      and public.lv_workspace_permission(w.id,'watchlist_write'))
);

commit;
