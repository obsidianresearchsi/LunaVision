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
    create table lv_memberships(workspace_id uuid,user_id uuid,role text);
    create table lv_records(id uuid primary key,workspace_id uuid,category text);
    create table lv_cameras(id uuid primary key,workspace_id uuid,name text,location text,playback_url text);
    create table lv_video_observations(id uuid primary key default gen_random_uuid(),workspace_id uuid,camera_id uuid,source text,frame_seconds numeric,summary text,created_by uuid default auth.uid());
    create table lv_workspace_activity(id bigint generated always as identity,workspace_id uuid,actor_id uuid,subject_id uuid,action text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    grant select on lv_workspaces,lv_records,lv_cameras to authenticated;
    grant insert(workspace_id,camera_id,source,frame_seconds,summary) on lv_video_observations to authenticated;
    insert into lv_workspaces(id,kind,active) values('${a}','agency',true),('${b}','agency',true),('${business}','business',true);
    insert into lv_memberships values('${a}','${admin}','admin'),('${a}','${member}','member'),('${b}','${outsider}','admin'),('${business}','${outsider}','owner');
    insert into lv_records values('${caseId}','${a}','investigation'),('${otherCase}','${b}','investigation');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/202611110002_agency_operations.sql',import.meta.url),'utf8'));
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
  await as(admin,`update lv_agency_rules set enabled=false where id='${ruleId}'`);
  await as(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',14,'car 99%','[{"label":"car","score":0.99}]')`);
  assert.equal((await as(member,'select * from lv_agency_alerts')).rows.length,1,'Disabled rule produces no alert');
  await denies(member,`insert into lv_video_observations(workspace_id,source,frame_seconds,summary,detections) values('${a}','file',15,'Invalid','[{"label":"car","score":1.1}]')`);
  const path = `${a}/${member}/evidence.pdf`;
  await as(member,`insert into storage.objects(bucket_id,name,metadata) values('lv-agency-evidence','${path}','{"size":10,"mimetype":"application/pdf"}')`);
  const evidenceSQL = (caseRef,bytes=10) => `insert into lv_agency_evidence(workspace_id,record_id,title,storage_path,file_name,mime_type,byte_size,sha256) values('${a}','${caseRef}','Original report','${path}','report.pdf','application/pdf',${bytes},'${'a'.repeat(64)}')`;
  await denies(member,evidenceSQL(otherCase));
  await denies(member,evidenceSQL(caseId,11));
  await as(member,evidenceSQL(caseId));
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
  assert.ok((await db.query('select count(*)::int as n from lv_workspace_activity')).rows[0].n>=6,'Operations audited');
  console.log('PASS: agency RLS, manager privileges, rule thresholds, duplicate prevention, disabled rules, invalid detections, alert transitions, stale writes, evidence isolation, file metadata checks, immutable evidence, orphan cleanup, suspension, audit.');
} finally { await db.close(); }
