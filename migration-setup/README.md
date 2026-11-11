# Lunar Vision Platform — New Project Setup & Full Database Migration Pack

This folder contains everything required to provision a brand-new Supabase + Vercel (or local Vite) deployment of the **Lunar Vision Platform** in the exact dependency order, or safely upgrade an existing database without re-running already committed migrations.

For the full formatted handbook, open **`LunarVision_New_Project_Setup_Guide.pdf`** in this folder.

---

## Folder Contents

| File / Folder | Purpose |
|---|---|
| `LunarVision_New_Project_Setup_Guide.pdf` | Complete illustrated setup, architecture, migration, API, and troubleshooting handbook (PDF). |
| `README.md` | Quick-start runbook and verification commands. |
| `FULL_MIGRATION_NEW_PROJECT.sql` | Single consolidated SQL script (`01` → `17` in exact sequence) safe for a **brand-new empty Supabase project**. |
| `ordered-migrations/01_*.sql` … `17_*.sql` | Numbered step-by-step migration files corresponding 1:1 with `supabase/migrations/`. |

---

## Which Option Should You Run?

### Option A — Brand-New Empty Supabase Project (Full Migration)
1. **Recommended (CLI):** Link the project and run `supabase db push` (uses `supabase/migrations/` in chronological timestamp order; Note: if the empty DB lacks legacy EagleEye v1 tables, skip `202611100003_legacy_quarantine.sql` or use **Option A.2** below).
2. **One-File SQL Editor Setup:** Open Supabase Dashboard → **SQL Editor**, paste the entire contents of `FULL_MIGRATION_NEW_PROJECT.sql`, and click **Run**. *(Step 03 safely checks `to_regclass(...)` before revoking legacy EagleEye v1 tables, so it will not error on an empty database.)*
3. **File-by-File SQL Editor Setup:** Open `ordered-migrations/` and execute `01_...sql` through `17_...sql` one file at a time in strict numerical order (`01` → `17`).

### Option B — Upgrading an Existing Supabase Project (e.g. `42701 already exists`)
**Do NOT run `FULL_MIGRATION_NEW_PROJECT.sql` or already-applied files on an existing database.**

Check which tables/functions already exist in Supabase SQL Editor first:

```sql
select
  to_regclass('public.lv_workspaces')        as step_01_workspaces,
  to_regclass('public.lv_intel_events')      as step_12_video_intel,
  to_regprocedure('public.lv_has_scope(uuid,text,integer)') as step_13_access_scope,
  to_regclass('public.lv_agency_subjects')   as step_14_biometrics,
  to_regprocedure('public.lv_configure_camera_connection(uuid,bigint,text,text,text,text,integer)') as step_16_cam_rpc,
  to_regprocedure('public.lv_staff_can_write(uuid,text,integer)') as step_17_viewer_guards;
```

Run **only** the files in `ordered-migrations/` corresponding to `NULL` results above, strictly in ascending numerical order:
- If `step_14_biometrics` is `NULL`: run `14_202611120003_enterprise_enrollment_migration.sql`
- If `step_16_cam_rpc` is `NULL`: run `15_202611120004_preserve_staff_access.sql` and `16_202611120005_camera_connections.sql`
- If `step_17_viewer_guards` is `NULL`: run `17_202611120006_viewer_write_guards.sql`

*(For example, if you already got `ERROR: 42701: column "clearance" of relation "lv_memberships" already exists` on `202611120002`, Step 13 is already applied — start from **Step 14** through **Step 17**.)*

---

## Complete Migration Execution Order (`01` → `17`)

| Order | Source File (`supabase/migrations/`) | Scope & Objects Created |
|---|---|---|
| `01` | `202611100001_workspaces.sql` | Core `lv_workspaces`, `lv_memberships`, `lv_platform_admins`, `lv_records`, base RLS & org RPCs. |
| `02` | `202611100002_cameras.sql` | `lv_cameras` with HTTPS playback validation and tenant RLS. |
| `03` | `202611100003_legacy_quarantine.sql` | Revokes public access from legacy v1 EagleEye tables & locks `mugshots` bucket. *(Guarded in this bundle via `to_regclass`.)* |
| `04` | `202611100004_record_status.sql` | Incident/investigation `status` column, `lv_record_activity`, `lv_change_record_status`. |
| `05` | `202611100005_vehicle_watchlist.sql` | `lv_vehicle_watchlist` table, active plate unique index, `lv_retire_vehicle_watch`. |
| `06` | `202611100006_workspace_governance.sql` | Active/entitlement status, `lv_workspace_activity`, `lv_workspace_active`, agency suspension & staff RPCs. |
| `07` | `202611100007_video_observations.sql` | `lv_video_observations` table & active-workspace insert/read policies. |
| `08` | `202611100008_corrective_actions.sql` | `lv_corrective_actions` for business incident remediation & completion RPC. |
| `09` | `202611110001_command_map.sql` | Geo-coordinates (`latitude`, `longitude`) for agency cameras & investigations. |
| `10` | `202611110002_agency_operations.sql` | `lv_agency_rules`, `lv_agency_alerts`, `lv_agency_evidence`, `lv-agency-evidence` private bucket. |
| `11` | `202611110003_operation_reliability.sql` | Optimistic-locking `revision` columns, `request_id` idempotent saves, evidence metadata verification. |
| `12` | `202611120001_video_intelligence.sql` | 5-tier roles, `lv_workspace_features`, `lv_camera_intel_settings`, `lv_intel_events`, `lv_vehicle_registry`, `lv_registry_imports`, ANPR matching, `lv-intel-snapshots` & `lv-vehicle-photos` buckets. |
| `13` | `202611120002_workspace_access.sql` | `viewer` role, clearance levels (`0..3`), `allowed_modules`, `lv_has_scope`, `lv_set_staff_access`, restrictive storage/table scopes, HLS/MJPEG camera stream support. |
| `14` | `202611120003_enterprise_enrollment_migration.sql` | `lv_subject_migrations`, `lv_agency_subjects`, `lv_subject_photos`, `lv_face_search_history`, `lv-subject-photos` bucket, Face++ 1:N search & migration RPCs, bulk `lv_import_watchlist`. |
| `15` | `202611120004_preserve_staff_access.sql` | Ensures legacy `lv_manage_workspace_access` preserves existing member clearance and allowed modules. |
| `16` | `202611120005_camera_connections.sql` | `lv_configure_camera_connection` RPC with revision check and stream/clearance updates. |
| `17` | `202611120006_viewer_write_guards.sql` | `lv_staff_can_write` helper and insert/upload triggers enforcing read-only behavior for `viewer` accounts. |

---

## New Project Environment & Auth Setup

### 1. Supabase Auth URL Configuration
In Supabase Dashboard → **Authentication → URL Configuration**, set **Site URL** and add these exact **Redirect URLs**:
- Local: `http://localhost:3000/business`, `http://localhost:3000/agency`, `http://localhost:3000/agency/admin`
- Production (Vercel): `https://<your-domain>/business`, `https://<your-domain>/agency`, `https://<your-domain>/agency/admin`

### 2. Environment Variables (`.env.local` locally / Vercel Project Settings in production)

| Variable | Visibility | Purpose |
|---|---|---|
| `VITE_WORKSPACE_PORTAL_ENABLED=true` | Client | Connects the portal UI to Supabase (`false` hides Supabase portals in Vercel previews). |
| `VITE_SUPABASE_URL` | Client | Supabase Project URL (`https://<ref>.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Client | Supabase public `anon` key. |
| `VITE_MAPBOX_ACCESS_TOKEN` | Client | Mapbox token for Command Center and Global Map tiles. |
| `VITE_GOOGLE_SIGN_IN_ENABLED` | Client | `true` to enable Google OAuth button, or `false`. |
| `VITE_EMAIL_AUTH_FLOWS_ENABLED` | Client | `true` to enable email sign-up/recovery flows. |
| `VITE_FACE_COMPARISON_ENABLED=true` | Client | Enables agency Face++ 1:1, 1:6 gallery, 1:N database search, and enrollment UI. |
| `FACEPP_API_KEY` | **Server-only** | Face++ API Key (used by `/api/face-compare` and `/api/face-intelligence`). |
| `FACEPP_API_SECRET` | **Server-only** | Face++ API Secret. Never prefix with `VITE_`. |
| `FACEPP_REGION` | **Server-only** | `US` (default `api-us.faceplusplus.com`) or `CN` (`api-cn.faceplusplus.com`). |
| `STAFF_SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Supabase Service Role Key for `/api/agency-accounts` (or `SUPABASE_SERVICE_ROLE_KEY`). Never prefix with `VITE_`. |
| `AGENCY_SETUP_ORIGIN` | **Server-only** | Exact origin URL (`http://127.0.0.1:3000` locally; `https://<your-domain>` on Vercel). |

### 3. Bootstrap the First Super Admin
After registering/confirming your Super Admin account in Supabase Auth, promote that user in SQL Editor:

```sql
insert into public.lv_platform_admins (user_id)
select id from auth.users where lower(email) = 'admin@your-agency.gov'
on conflict do nothing;
```

Then sign in at `/agency/admin` to create Security Agency organizations and issue agency administrator accounts. Business users self-register at `/business`.

### 4. Local & Build Verification

```bash
npm ci
npx tsc --noEmit
npm run test:agency
node tests/workspace-access.integration.mjs
npm run build
```

