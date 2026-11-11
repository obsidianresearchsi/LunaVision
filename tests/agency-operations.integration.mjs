import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// A real PostgreSQL engine exercises privileges, RLS, triggers and RPCs without touching production.
const db = new PGlite();
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const business = '10000000-0000-4000-8000-000000000003';
const admin = '20000000-0000-4000-8000-000000000001';
const member = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
const caseId = '30000000-0000-4000-8000-000000000001';
const otherCase = '30000000-0000-4000-8000-000000000002';
async function as(user, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
}
async function denies(user, sql) { await assert.rejects(() => as(user, sql)); }
try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to authenticated;
    create table lv_workspaces(id uuid primary key,kind text,active boolean default true,name text default 'QA workspace');
    create table lv_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
    create table lv_platform_admins(user_id uuid primary key);
    create function lv_workspace_active(target uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.lv_workspaces w join public.lv_memberships m on m.workspace_id=w.id where w.id=target and w.active and m.user_id=auth.uid())$$;
    create table lv_records(id uuid primary key,workspace_id uuid,category text);
    create table lv_cameras(id uuid primary key,workspace_id uuid,name text,location text,playback_url text);
    create table lv_video_observations(id uuid primary key default gen_random_uuid(),workspace_id uuid,camera_id uuid,source text,frame_seconds numeric,summary text,created_by uuid default auth.uid());
    create table lv_workspace_activity(id bigint generated always as identity,workspace_id uuid,actor_id uuid,subject_id uuid,action text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    grant select on lv_workspaces,lv_records,lv_cameras,lv_platform_admins to authenticated;
    grant insert(workspace_id,camera_id,source,frame_seconds,summary) on lv_video_observations to authenticated;
    insert into lv_workspaces(id,kind,active) values('${a}','agency',true),('${b}','agency',true),('${business}','business',true);
    insert into lv_memberships values('${a}','${admin}','admin'),('${a}','${member}','member'),('${b}','${outsider}','admin'),('${business}','${outsider}','owner');
    insert into lv_platform_admins values('${admin}');
    insert into lv_records values('${caseId}','${a}','investigation'),('${otherCase}','${b}','investigation');
    insert into lv_cameras values('40000000-0000-4000-8000-000000000001','${a}','North camera','North','https://example.com/north.mp4'),('40000000-0000-4000-8000-000000000002','${b}','Other camera','Other','https://example.com/other.mp4'),('40000000-0000-4000-8000-000000000003','${business}','Lobby camera','Lobby','https://example.com/lobby.mp4');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611100005_vehicle_watchlist.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611110002_agency_operations.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611110003_operation_reliability.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611120001_video_intelligence.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611120003_enterprise_enrollment_migration.sql',import.meta.url),'utf8'));
  const rule = await as(admin,`insert into lv_agency_rules(workspace_id,name,object_label,minimum_confidence,severity) values('${a}','Vehicle threshold','car',0.8,'high') returning id`);
  const ruleId = rule.rows[0].id;
  await denies(member,`insert into lv_agency_rules(workspace_id,name,object_label,minimum_confidence,severity) values('${a}','Forbidden rule','car',0.8,'high')`);
  await denies(outsider,`insert into lv_agency_rules(workspace_id,name,object_label,minimum_confidence,severity) values('${business}','Business rule','car',0.8,'high')`);
  await as(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',12,'car 92%','[{"label":"car","score":0.92},{"label":"car","score":0.9}]')`);
  let alerts = await as(member,`select * from lv_agency_alerts`);
  assert.equal(alerts.rows.length,1,'One alert per matched rule, not per object');
  const alertId = alerts.rows[0].id;
  assert.equal(alerts.rows[0].created_by,member);
  assert.equal((await as(outsider,'select * from lv_agency_alerts')).rows.length,0,'Cross-agency reads blocked');
  await denies(outsider,`select lv_transition_alert('${alertId}','open','acknowledged')`);
  await denies(member,`select lv_transition_alert('${alertId}','open','resolved')`);
  await as(member,`select lv_transition_alert('${alertId}','open','acknowledged')`);
  await denies(member,`select lv_transition_alert('${alertId}','open','acknowledged')`);
  await as(member,`select lv_transition_alert('${alertId}','acknowledged','resolved')`);
  await denies(member,`update lv_agency_alerts set status='open' where id='${alertId}'`);
  await as(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',13,'car 70%','[{"label":"car","score":0.7}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,1,'Below-threshold observation produces no alert');
  await as(admin,`select lv_update_agency_rule('${ruleId}',1,'Vehicle threshold',0.8,'high',false,60)`);
  await denies(admin,`select lv_update_agency_rule('${ruleId}',1,'Stale write',0.9,'low',true,60)`);
  await denies(member,`select lv_update_agency_rule('${ruleId}',2,'Member edit',0.9,'low',true,60)`);
  await denies(admin,`update lv_agency_rules set enabled=true where id='${ruleId}'`);
  await as(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',14,'car 99%','[{"label":"car","score":0.99}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,1,'Disabled rule produces no alert');
  await denies(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',15,'Invalid','[{"label":"car","score":1.1}]')`);
  const eventId='50000000-0000-4000-8000-000000000001';
  const save=`select lv_save_observation('${a}','${eventId}',null,16,'Idempotent frame','[{"label":"car","score":0.95}]') as id`;
  const firstSave=await as(member,save);
  assert.equal((await as(member,save)).rows[0].id,firstSave.rows[0].id,'Lost acknowledgement retry returns original observation');
  assert.equal((await db.query(`select count(*)::int as n from lv_video_observations where request_id='${eventId}'`)).rows[0].n,1);
  await denies(member,`select lv_save_observation('${a}','${eventId}',null,16,'Different content','[]')`);
  await denies(member,`select lv_save_observation('${b}','${eventId}',null,16,'Wrong workspace','[]')`);
  await denies(member,`select lv_save_observation('${a}',gen_random_uuid(),'40000000-0000-4000-8000-000000000002',16,'Wrong camera','[]')`);
  await as(admin,`select lv_update_agency_rule('${ruleId}',2,'Vehicle threshold',0.8,'high',true,60)`);
  await as(member,`select lv_save_observation('${a}',gen_random_uuid(),null,17,'Cooldown frame','[{"label":"car","score":0.99}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,1,'Repeat alert suppressed inside cooldown');
  await as(member,`select lv_save_observation('${a}',gen_random_uuid(),'40000000-0000-4000-8000-000000000001',17,'Camera frame','[{"label":"car","score":0.99}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,2,'Different camera has independent cooldown');
  await db.exec(`update lv_agency_alerts set created_at=now()-interval '61 seconds' where rule_id='${ruleId}'`);
  await as(member,`select lv_save_observation('${a}',gen_random_uuid(),null,18,'After cooldown','[{"label":"car","score":0.99}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,3,'Rule alerts again after cooldown');
  await as(admin,`select lv_update_agency_camera('40000000-0000-4000-8000-000000000001',1,'Updated camera','North','https://example.com/new.mp4')`);
  await denies(admin,`select lv_update_agency_camera('40000000-0000-4000-8000-000000000001',1,'Stale camera','North','https://example.com/new.mp4')`);
  await denies(member,`select lv_update_agency_camera('40000000-0000-4000-8000-000000000001',2,'Member camera','North','https://example.com/new.mp4')`);
  await denies(outsider,`select lv_update_agency_camera('40000000-0000-4000-8000-000000000001',2,'Outsider camera','North','https://example.com/new.mp4')`);
  const path = `${a}/${member}/evidence.pdf`;
  await as(member,`insert into storage.objects(bucket_id,name,metadata) values('lv-agency-evidence','${path}','{"size":10,"mimetype":"application/pdf"}')`);
  const evidenceSQL = (caseRef,bytes=10) => `insert into lv_agency_evidence(workspace_id,record_id,title,storage_path,file_name,mime_type,byte_size,sha256) values('${a}','${caseRef}','Original report','${path}','report.pdf','application/pdf',${bytes},'${'a'.repeat(64)}')`;
  await denies(member,evidenceSQL(otherCase));
  await denies(member,evidenceSQL(caseId,11));
  await as(member,evidenceSQL(caseId));
  const register=`select lv_register_evidence('${a}','${caseId}','Original report','','${path}','report.pdf','application/pdf',10,'${'a'.repeat(64)}') as id`;
  const registered=await as(member,register);
  assert.equal((await as(member,register)).rows[0].id,registered.rows[0].id,'Evidence retries do not create duplicate registrations');
  await denies(member,register.replace('Original report','Changed report'));
  await denies(admin,register);
  assert.equal((await as(outsider,'select * from lv_agency_evidence')).rows.length,0);
  assert.equal((await as(outsider,'select * from storage.objects')).rows.length,0);
  assert.equal((await as(member,'select * from storage.objects')).rows.length,1);
  await as(member,`delete from storage.objects where name='${path}'`);
  assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1,'Registered evidence cannot be deleted');
  await denies(member,`update lv_agency_evidence set sha256='${'b'.repeat(64)}'`);
  const orphan = `${a}/${member}/orphan.pdf`;
  await as(member,`insert into storage.objects(bucket_id,name,metadata) values('lv-agency-evidence','${orphan}','{}')`);
  await as(member,`delete from storage.objects where name='${orphan}'`);
  assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1,'Failed registrations can clean up orphan uploads');
  await db.exec(`update lv_workspaces set active=false where id='${a}'`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,0,'Suspension blocks existing alerts');
  assert.equal((await as(member,'select * from storage.objects')).rows.length,0,'Suspension blocks evidence downloads');
  await denies(member,`insert into lv_agency_alerts(workspace_id,title,severity) values('${a}','Suspended report','high')`);
  await db.exec(`update lv_workspaces set active=true where id='${a}'`);

  // --- Video Intelligence, Roles, Watchlist, Registry & Analytics Tests ---
  const supervisor = '20000000-0000-4000-8000-000000000004';
  const investigator = '20000000-0000-4000-8000-000000000005';
  const northCam = '40000000-0000-4000-8000-000000000001';
  const bizCam = '40000000-0000-4000-8000-000000000003';
  await db.exec(`insert into lv_memberships values('${a}','${supervisor}','supervisor'),('${a}','${investigator}','investigator')`);

  // Feature entitlements: agency vs business defaults & super admin overrides
  const agencyFeatures = (await as(member, `select lv_workspace_feature_map('${a}') as f`)).rows[0].f;
  assert.equal(agencyFeatures.anpr, true);
  assert.equal(agencyFeatures.business_intelligence, false);
  const bizFeatures = (await as(outsider, `select lv_workspace_feature_map('${business}') as f`)).rows[0].f;
  assert.equal(bizFeatures.anpr, false);
  assert.equal(bizFeatures.business_intelligence, true);
  await denies(outsider, `select lv_set_workspace_feature('${business}','anpr',true)`);
  await as(admin, `select lv_set_workspace_feature('${a}','vehicle_registry',false)`);
  assert.equal((await as(member, `select lv_feature_enabled('${a}','vehicle_registry') as ok`)).rows[0].ok, false);
  await as(admin, `select lv_set_workspace_feature('${a}','vehicle_registry',true)`);

  // Camera intelligence configuration & validation
  const validCamSettings = JSON.stringify({
    capabilities: {
      people_detection: { enabled: true, sensitivity: 'medium' },
      people_counting: { enabled: true, sensitivity: 'medium' },
      occupancy: { enabled: true, sensitivity: 'high' },
      anpr: { enabled: true, sensitivity: 'high' },
    },
    zones: [
      { id: 'gate_line', name: 'Main Gate Line', kind: 'count_line', points: [[0.1, 0.5], [0.9, 0.5]], direction: 'down' },
      { id: 'vault_zone', name: 'Restricted Vault', kind: 'restricted', points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] },
    ],
    thresholds: { crowd_max: 20, occupancy_max: 50, loiter_seconds: 30, stationary_seconds: 120, abandoned_seconds: 45, alert_cooldown_seconds: 60 },
    schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: '06:00', end: '22:00' },
    notify: { categories: ['crowd', 'intrusion', 'watchlist_match', 'tamper'] },
  });
  await denies(supervisor, `select lv_save_camera_intel('${a}','${northCam}',0,'${validCamSettings}'::jsonb)`);
  const rev1 = (await as(admin, `select lv_save_camera_intel('${a}','${northCam}',0,'${validCamSettings}'::jsonb) as r`)).rows[0].r;
  assert.equal(Number(rev1), 1);
  await denies(admin, `select lv_save_camera_intel('${a}','${northCam}',0,'${validCamSettings}'::jsonb)`);
  // Business workspace cannot enable ANPR on its camera
  await denies(outsider, `select lv_save_camera_intel('${business}','${bizCam}',0,'{"capabilities":{"anpr":{"enabled":true,"sensitivity":"high"}}}'::jsonb)`);
  await as(outsider, `select lv_save_camera_intel('${business}','${bizCam}',0,'{"capabilities":{"people_counting":{"enabled":true,"sensitivity":"medium"}}}'::jsonb)`);

  // Watchlist role hierarchy: member denied write, investigator can add/edit, supervisor can archive, admin can delete
  await denies(member, `insert into lv_vehicle_watchlist(workspace_id,plate,reason,case_reference) values('${a}','LAG123AA','stolen','CR-101')`);
  const watchInsert = await as(investigator, `insert into lv_vehicle_watchlist(workspace_id,plate,reason,case_reference,make,model,colour,description,status) values('${a}','LAG123AA','stolen','CR-101','Toyota','Hilux','White','Armed robbery getaway','active') returning id, revision`);
  const watchId = watchInsert.rows[0].id;
  await as(investigator, `select lv_update_vehicle_watch('${watchId}',1,'wanted','CR-101B','Toyota','Hilux','White',null,'Updated description','Check North gate','active','')`);
  await denies(investigator, `select lv_retire_vehicle_watch('${watchId}')`);
  await denies(supervisor, `select lv_delete_vehicle_watch('${watchId}')`);

  // Pre-populated Vehicle Registry import, validation, duplicate detection & sync
  const importBatch = JSON.stringify([
    { plate: 'lag-123-aa', make: 'Toyota', model: 'Hilux', colour: 'White', vehicle_type: 'Truck', year: '2022', registration_status: 'registered', notes: 'Fleet A' },
    { plate: 'ABJ 999 ZZ', make: 'Honda', model: 'Accord', colour: 'Black', vehicle_type: 'Car', year: '2020', registration_status: 'expired', notes: '' },
    { plate: 'ABJ-999-ZZ', make: 'Honda', model: 'Civic', colour: 'Blue', vehicle_type: 'Car', year: '2021', registration_status: 'registered', notes: 'Duplicate in file' },
    { plate: '!', make: 'Bad', model: 'Plate', year: '2020', registration_status: 'registered' },
  ]);
  await denies(investigator, `select lv_import_registry('${a}','FRSC Batch 1','vehicles.csv','${importBatch}'::jsonb,false)`);
  const imp1 = (await as(supervisor, `select lv_import_registry('${a}','FRSC Batch 1','vehicles.csv','${importBatch}'::jsonb,false) as res`)).rows[0].res;
  assert.equal(imp1.inserted, 2);
  assert.equal(imp1.duplicates, 1);
  assert.equal(imp1.invalid, 1);

  // Real-time ANPR event ingestion + automatic watchlist matching + registry enrichment
  const plateReqId = '60000000-0000-4000-8000-000000000001';
  const nowIso = new Date().toISOString();
  const eventsBatch = JSON.stringify([
    {
      request_id: plateReqId,
      camera: northCam,
      source: 'camera',
      category: 'plate_read',
      object_class: 'car',
      plate: 'lag 123-aa',
      confidence: 0.94,
      occurred_at: nowIso,
      payload: { summary: 'North gate plate read' },
    },
    {
      request_id: '60000000-0000-4000-8000-000000000002',
      camera: northCam,
      source: 'camera',
      category: 'occupancy',
      object_class: 'person',
      zone: 'main_hall',
      count: 14,
      occurred_at: nowIso,
      payload: { summary: '14 people in Main Hall' },
    },
  ]);
  const ingestRes = (await as(member, `select lv_record_intel_events('${a}','${eventsBatch}'::jsonb) as res`)).rows[0].res;
  assert.equal(ingestRes.saved, 2);
  assert.equal(ingestRes.matches.length, 1, 'Normalized plate automatically matches active watchlist');
  assert.equal(ingestRes.matches[0].plate, 'LAG123AA');
  assert.ok(ingestRes.matches[0].alert_id, 'Immediate alert created for watchlist match');

  // Business workspace cannot ingest plate_read events
  await denies(outsider, `select lv_record_intel_events('${business}','[{"request_id":"60000000-0000-4000-8000-000000000009","camera":"${bizCam}","source":"camera","category":"plate_read","object_class":"car","plate":"LAG123AA","occurred_at":"${nowIso}"}]'::jsonb)`);

  // Business workspace can ingest occupancy/footfall events and query timeseries & current occupancy
  await as(outsider, `select lv_record_intel_events('${business}','[{"request_id":"60000000-0000-4000-8000-000000000010","camera":"${bizCam}","source":"camera","category":"occupancy","object_class":"person","zone":"lobby","count":8,"occurred_at":"${nowIso}"}]'::jsonb)`);
  const occ = await as(outsider, `select * from lv_intel_current_occupancy('${business}')`);
  assert.equal(occ.rows.length, 1);
  assert.equal(occ.rows[0].current_count, 8);
  const ts = await as(outsider, `select * from lv_intel_timeseries('${business}', now() - interval '1 day', now() + interval '1 hour', 'hour', null)`);
  assert.equal(ts.rows.length, 1);

  // Supervisor archives watchlist entry, Admin deletes it
  await as(supervisor, `select lv_retire_vehicle_watch('${watchId}')`);
  await as(admin, `select lv_delete_vehicle_watch('${watchId}')`);

  // --- Enterprise Subject Enrollment, Migration, Face Search History & Bulk Plate Watchlist Migration Tests ---
  const bizBiometric = (await as(outsider, `select lv_workspace_feature_map('${business}') as f`)).rows[0].f;
  assert.equal(bizBiometric.biometric_enrollment, false);
  assert.equal(bizBiometric.face_search, false);
  await denies(outsider, `select lv_upsert_agency_subject('${business}', '{"full_name":"Blocked"}'::jsonb, '[]'::jsonb)`);

  // Start migration + upsert subject with multi-angle photos
  const migId = (await as(supervisor, `select lv_start_subject_migration('${a}','LEGACY_AFIS','legacy_dossiers.csv',10) as id`)).rows[0].id;
  assert.ok(migId);
  await denies(member, `select lv_upsert_agency_subject('${a}', '{"subject_code":"SUBJ-01","full_name":"Ibrahim Musa"}'::jsonb, '[]'::jsonb)`);

  const subRes = await as(
    investigator,
    `select id, revision from lv_upsert_agency_subject('${a}', '{"subject_code":"SUBJ-01","full_name":"Ibrahim Musa","category":"wanted","threat_level":"high","offense_summary":"Armed robbery","warrant_reference":"WR-99","migration_id":"${migId}","face_token":"tok_1234567890abcdef","face_indexed":true}'::jsonb, '[{"storage_path":"${a}/subj1_front.jpg","face_token":"tok_1234567890abcdef","face_indexed":true,"angle_label":"frontal","is_primary":true,"quality_score":91.5}]'::jsonb)`,
  );
  const subId = subRes.rows[0].id;
  assert.equal(Number(subRes.rows[0].revision), 1);

  // Upsert by same subject_code increments revision cleanly without duplicate
  const subUpsert = await as(
    investigator,
    `select id, revision from lv_upsert_agency_subject('${a}', '{"subject_code":"SUBJ-01","full_name":"Ibrahim Musa","last_known_location":"Apapa Wharf"}'::jsonb, '[]'::jsonb)`,
  );
  assert.equal(subUpsert.rows[0].id, subId);
  assert.equal(Number(subUpsert.rows[0].revision), 2);

  await as(supervisor, `select lv_update_subject_migration('${migId}', 10, 9, 1, 0, 'completed_with_errors', '[{"row":4,"error":"No face detected"}]'::jsonb)`);

  // Cross-agency read blocked
  assert.equal((await as(outsider, 'select * from lv_agency_subjects')).rows.length, 0);
  assert.equal((await as(outsider, 'select * from lv_subject_photos')).rows.length, 0);

  // Log 1:N search history
  const histId = (await as(member, `select lv_log_face_search('${a}', 'faceset_1n', '${a}/probes/probe1.jpg', 89.4, '[{"subject_id":"${subId}","full_name":"Ibrahim Musa","confidence":89.4}]'::jsonb, '{"quality":88}'::jsonb, 'CASE-404', 'Checkpoint inquiry') as id`)).rows[0].id;
  assert.ok(histId);
  assert.equal((await as(outsider, 'select * from lv_face_search_history')).rows.length, 0);

  // Role gates for archiving & deleting subject records
  await denies(investigator, `select lv_retire_agency_subject('${subId}')`);
  await as(supervisor, `select lv_retire_agency_subject('${subId}')`);
  await denies(supervisor, `select lv_delete_agency_subject('${subId}')`);
  await as(admin, `select lv_delete_agency_subject('${subId}')`);

  // Bulk plate watchlist migration
  const wlBatch = JSON.stringify([
    { plate: 'KJA 111 AA', category: 'stolen', case_reference: 'CR-501', make: 'Toyota', model: 'Camry', colour: 'Black' },
    { plate: 'KJA-111-AA', category: 'wanted', case_reference: 'CR-501B' },
    { plate: 'ABJ 222 BB', category: 'diplomatic', case_reference: 'CR-502', make: 'Lexus', model: 'LX570' },
    { plate: 'X', category: 'stolen', case_reference: 'CR-BAD' },
  ]);
  const wlImp1 = (await as(investigator, `select lv_import_watchlist('${a}','Interpol Feed','stolen_batch.csv','${wlBatch}'::jsonb,false) as res`)).rows[0].res;
  assert.equal(wlImp1.inserted, 2);
  assert.equal(wlImp1.duplicates, 1);
  assert.equal(wlImp1.invalid, 1);

  assert.ok((await db.query('select count(*)::int as n from lv_workspace_activity')).rows[0].n>=18,'Operations audited');
  console.log('PASS: agency isolation, manager permissions, role hierarchy, feature entitlements, camera intel settings, ANPR watchlist matching, bulk watchlist & vehicle registry migrations, subject enrollment & Face++ search audit history, timeseries & occupancy reporting, evidence integrity, suspension, audit.');
} catch (error) { console.error(error.message); process.exitCode=1; }
finally { await db.close(); }
