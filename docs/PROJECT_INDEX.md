# LunaVision Platform folder index

## Source snapshot · 2026-11-10

The folder contains a web investigation application still branded **EagleEye
Nigeria** in the browser title, sign-in screen, navigation and web manifest.
The Lunar Vision briefs and mockups in the parent workspace describe a broader
camera-first product.

### Where to look

- [Web entry point](../index.tsx), [application state](../App.tsx) and
  [navigation shell](../components/Layout.tsx) start the React 19 and TypeScript
  SPA. The app switches views through React state. Vite is configured for port 3000.
- [Dashboard](../pages/Dashboard.tsx) and [map](../pages/GlobalMap.tsx) provide
  overview and geographic views. [Map configuration](../services/mapConfig.ts)
  selects the basemap.
- [Cases](../pages/Cases.tsx), [case detail](../pages/CaseDetail.tsx) and
  [case service](../services/caseService.ts) cover assignment, status, linked
  records and activity. [Report rendering](../services/caseReportGenerator.ts)
  and [history](../pages/History.tsx) cover reporting and search audit review.
- [Search](../pages/Search.tsx), [results](../pages/Results.tsx),
  [enrollment](../pages/Enrollment.tsx) and [analyst review](../services/analystReviewService.ts)
  are the investigation and manual review surfaces. Face++ and Gemini are
  provider dependencies.
- [Monitoring](../pages/SurveillanceDashboard.tsx), [camera management](../pages/CameraManagement.tsx)
  and [demo simulation](../services/demoSimulation.ts) cover registered cameras,
  displayed detections and simulated feeds. The normal camera grid uses
  placeholders. Expanded views pass the configured URL to a browser video element.
- [Supabase data access](../services/supabaseDb.ts) and
  [image storage](../services/supabaseStorage.ts) are accessed from the browser.
  [Sign-in](../pages/Login.tsx) uses a demo user lookup with no password
  verification. The separate [crawler backend](../crawler-backend/README.md)
  is an Express service on port 3001, with its own dependencies and configuration.
- [Web manifest](../public/manifest.json) and icons provide install metadata.
  The folder includes a prebuilt dist directory, requirements in .kiro/specs,
  and 28 test files outside generated output and dependencies.

### Relationship to the Lunar Vision designs

The map, camera inventory, monitoring layout, alert UI, case workflows and
reporting are existing web surfaces. The source does not show an end-to-end
camera gateway, secure device provisioning, recording or timeline playback.
The expanded player is a browser video element, and the detection frame
processor has no application call site. The existing case records and notes
are distinct from the mockup's media evidence vault and BodyCam chain of
custody. No native mobile project, organization/site tenancy model, or
NINAuth integration was found in this folder.

### Verification scope

Reviewed local source and documentation. This copy has no Git metadata and
no root node_modules directory. The crawler backend has its own installed
dependencies. Build output is present, but no fresh build, tests, or external
service calls were run. Live camera behavior, Supabase permissions and provider
availability remain unverified. The dated notes below are historical.

---

## Historical EagleEye project index

Indexed from the working tree on 2026-10-31. This describes the current source,
including existing uncommitted work. External deployments and database policies
were not inspected. No application behavior was changed during indexing.

## Project shape

EagleEye Nigeria is an investigation application with facial image search,
subject enrollment, maps, case management, watchlists, and surveillance UI.
It consists of two independently configured Node packages:

- Root: React 19 / TypeScript SPA built by Vite, serving on port 3000.
- `crawler-backend/`: Express / TypeScript service on port 3001, plus a CLI.

The browser accesses Supabase directly for most persistence. The crawler has
its own Supabase client using an environment-configured service key.
Face++ supplies facial detection and search; Gemini supplies image descriptions.
There is no general application API server in this checkout.

## Entry points and navigation

The 2026-11-01 UI upgrade adds `components/OperationsUI.tsx` and
`styles/operations.css` for the case register, case dossier, history, watchlist,
and surveillance workspaces. `components/useDialogAccessibility.ts` supplies
focus management for the two case-linking dialogs.

Search now passes its persisted audit-log ID through `App.tsx` into results;
case linking and watchlist enrollment use the signed-in officer ID rather than
placeholder IDs. History can link its existing audit records without fabricating
subject results. Case files display saved subject and search connections, with
read-only subject profile enrichment. Partial linking failures remain visible.

The map uses `services/mapConfig.ts`, with a Mapbox satellite basemap configured
through `VITE_MAPBOX_ACCESS_TOKEN` and CARTO as the unconfigured fallback. Map
initialization is separate from overlay refresh, and event handlers and map
animations are stopped during cleanup. Existing filters, popups, routes, and
camera controls retain their data sources.

The 2026-11-02 analyst-review update adds `CandidateReviewModal.tsx`,
`services/analystReviewService.ts`, `utils/similarityPresentation.ts`, and
`styles/analyst-review.css`. Scores are displayed as provider similarity out of
100. Legacy `EXACT` / `RELATIVE` codes remain in storage for compatibility, but
their presentation uses neutral higher/lower similarity bands. They are not
identity, family-relationship, or threat determinations.

An explicit review requires an active case, a selected non-identifying outcome,
written reasoning, and acknowledgement of score limitations. Reviews use the
existing case-note and `NOTE_ADDED` activity paths, retaining the original search
ID, candidate reference, provider score, reviewer, outcome, and rationale. Reviews
do not enroll faces, link subjects, alter scores, or notify command. Existing
case-note authorization and persistence limitations still apply; these are not
claimed to be tamper-proof records. Results, case-link displays, and exports use
the revised score terminology. Automated kinship claims and score-derived threat
assessments were removed. Generated observations are limited to image conditions.
Provider calls, thresholds, candidate selection, and ranking were unchanged.

- `index.html`: HTML shell, Tailwind CDN configuration, Leaflet CDN assets,
  fonts, print styles, and manifest link.
- `index.tsx`: React root, rendered in StrictMode.
- `App.tsx`: login state, current-page switch, search results, selected case,
  subject editing, and right inspector panel. Navigation uses React state;
  there is no URL router.
- `components/Layout.tsx`: shared shell, navigation, and notification integration.
- `types.ts`: shared domain models, enums, input types, and filter types.
- `components/StartupScreen.tsx`: initial startup animation.

## Feature locations

- Search: `pages/Search.tsx`, `pages/Results.tsx`, `services/faceEngine.ts`,
  `services/facepp.ts`.
- Enrollment and profile editing: `pages/Enrollment.tsx`,
  `utils/imageCompression.ts`, `services/supabaseStorage.ts`.
- Overview and geography: `pages/Dashboard.tsx`, `pages/GlobalMap.tsx`,
  `components/CameraMarker.tsx`.
- Search audit history: `pages/History.tsx`, `services/supabaseDb.ts`.
- Crawling: `pages/Crawler.tsx`, `pages/CrawledFaces.tsx`,
  `services/crawlerApi.ts`, `crawler-backend/src/`.
- Cases: `pages/Cases.tsx`, `pages/CaseDetail.tsx`, `services/caseService.ts`,
  `services/activityService.ts`, `services/caseReportGenerator.ts`.
- Case linking and assignment: `components/AddToCaseModal.tsx`,
  `components/LinkSearchToCaseModal.tsx`, `components/AssignOfficerModal.tsx`.
- Notifications: `components/NotificationBell.tsx`,
  `services/notificationService.ts`.
- Surveillance: `pages/SurveillanceDashboard.tsx`, `pages/CameraManagement.tsx`,
  `components/CameraFeedCard.tsx`, `components/CameraFeedModal.tsx`,
  `components/CameraManagementModal.tsx`, `services/cameraService.ts`.
- Watchlists and detections: `pages/Watchlist.tsx`, `pages/DetectionHistory.tsx`,
  `components/POICard.tsx`, `components/AddPOIModal.tsx`,
  `components/DetectionAlertPopup.tsx`, `services/watchlistService.ts`,
  `services/detectionService.ts`, `services/alertService.ts`.
- Demo surveillance events and animated feeds: `services/demoSimulation.ts`.
- Provider configuration: `pages/Settings.tsx`, `services/settings.ts`.

## Main data flows

### Search

1. `Search.tsx` reads the uploaded image and calls `searchCriminalDatabase`.
2. `faceEngine.ts` loads settings, detects a face, and queries the Face++ faceset.
3. Returned tokens are joined to Supabase subject records. Missing records become
   an "Unknown Subject" result.
4. Provider thresholds classify candidates into the application's `EXACT` and
   `RELATIVE` labels; lower scores are omitted.
5. The page writes an audit log containing the probe image as a data URL.
6. Gemini generates a description, then `App.tsx` switches to the results page.

The `deepSearch` argument does not change the search engine query. The page
changes messaging and the audit-log search type. The current search UI's label
also has no event handler to toggle this state.
The `RELATIVE` label is assigned from similarity thresholds; there is no separate
kinship validation implementation.

### Enrollment

The original image goes to Face++ for token generation and faceset enrollment.
A compressed image goes to the Supabase `mugshots` bucket, and subject metadata
goes to `suspects`. Coordinates are entered manually or inferred from a fixed
lookup of Nigerian cities. Existing subjects can be edited through the same page.

### Cases

Case services manage ownership, assignment, subject/search links, notes,
activities, and notifications. Status transitions are sequential:
`OPEN -> IN_PROGRESS -> UNDER_REVIEW -> CLOSED`. Reports combine case details,
linked subjects, activities, and notes into formatted content.

### Crawling

`crawlerApi.ts` calls the backend and listens to Server-Sent Events.
`WebCrawler.ts` fetches HTML with Axios, extracts images and same-domain links
with Cheerio, and schedules work with p-queue. Sharp processes downloaded images;
Face++ detects and indexes faces; Supabase stores images and subject records.
`SocialMediaCrawler.ts` contains a Puppeteer-based public-profile flow.
`services/crawler.ts` is a separate older simulated browser-side crawler;
the current crawler page imports `crawlerApi.ts`.

### Surveillance

Camera, watchlist, detection, and alert services persist records in Supabase.
The dashboard polls cameras and recent detections every 30 seconds and has an
explicit demo mode. Grid cards show placeholders outside demo mode; the modal
contains a video element. `processFrame` expects already detected face tokens,
matches exact tokens against the watchlist, and stores detections. No application
caller connecting video frames to `processFrame` was found.

The enhanced demo uses `components/DemoCameraScene.tsx` for four local synthetic
scenes and fictional African portraits under `public/demo/` (generation prompts
and provenance are in that directory's README). Demo detections reuse their
fictional reference portrait rather than an unrelated external snapshot. Demo
events are kept in component memory, never saved as real detections. Real-data
polling is skipped during demo mode; stopping restores the previous camera
selection and layout. Expanded demo feeds render the same synthetic scene and
can capture a labelled synthetic snapshot. `DetectionAlertPopup.tsx` renders in a
body portal with priority accents, comparison images, callback actions, and a
stable ten-second auto-dismiss timer. Initial demo detection remains at eight
seconds and dashboard recurring events at twenty-five seconds.

## Persistence and integrations

- `services/supabase.ts`: browser Supabase client with hardcoded project URL and
  public anon key. Database authorization policies were not verified.
- `services/supabaseDb.ts`: users, suspects, and audit logs.
- `services/db.ts`: deprecated compatibility export of `supabaseDb`.
- `services/supabaseStorage.ts`: mugshot naming, public URLs, uploads, deletion.
- `utils/caseConversion.ts`: database snake_case / application camelCase mapping.
- `services/settings.ts`: provider credentials stored in the `settings` table,
  cached in memory for 30 seconds and retrieved by browser code.
- `services/facepp.ts`: queued requests, faceset initialization, detection/search;
  primarily uses a Supabase `facepp-proxy` Edge Function with a direct fallback.
  The deployed function's source is not included here.
- `services/faceEngine.ts`: Face++ result processing and Gemini SDK invocation.

Referenced tables include `users`, `suspects`, `audit_logs`, `settings`, `cases`,
`case_activities`, `case_notes`, `case_linked_subjects`, `case_linked_searches`,
`notifications`, `cameras`, `watchlist`, `detections`, and `surveillance_alerts`.
Schema examples exist in `.kiro/specs/`; no standalone SQL migration files were
found in the source inventory.

## Setup and commands

- Frontend: `npm install`, `npm run dev`, `npm run build`, `npm run preview`.
- Frontend crawler URL: `VITE_CRAWLER_API_URL`, defaults to
  `http://localhost:3001`.
- Backend: from `crawler-backend/`, run `npm install`, `npm run dev`,
  `npm run build`, `npm start`, or `npm run crawl -- ...`.
- Backend environment names are defined in `src/config/index.ts`: Supabase URL
  and service key, Face++ key/secret/faceset, crawler limits, and server port.
  A backend `.env` exists locally; its values were not read during indexing.
- Root Vite config also maps `GEMINI_API_KEY` into build-time definitions;
  the active image-analysis implementation reads the key from Supabase settings.
- Root package scripts do not include test or type-check commands. Vitest and
  TypeScript are installed as development dependencies.

## Documentation and implementation caveats

- Root `README.md` predates Supabase migration, cases, and surveillance. Its
  localStorage and security descriptions do not describe the current source.
- `.kiro/specs/` holds requirements, designs, and task lists for Supabase
  migration, image storage, cases, surveillance, credentials, and PWA manifest.
  Checked task boxes are not independent runtime verification.
- `docs/Government-Proposal.md` and
  `docs/EagleEye-Intelligence-Presentation.md` contain product-facing material.
- Login is explicitly a demo: it looks up an existing username and accepts any
  password. The first-run flow writes a chief-commander user record. No Supabase
  Auth sign-in is performed by this flow.
- The manifest and icons are present. Their presence alone does not establish
  offline operation; no service-worker implementation was found.
- The working tree contained extensive modified and untracked files before
  indexing. Preserve them when making future changes.

## Verification on 2026-10-31

- `npm run build`: passed. Vite warned about a roughly 1 MB minified JavaScript
  chunk and mixed static/dynamic imports of the Gemini SDK.
- Root `tsc --noEmit --pretty false`: failed on a missing `originalImageUrl` in
  `crawler-backend/src/crawler/SocialMediaCrawler.ts:192`, plus missing `beforeAll`
  imports/types in `public/manifest.test.ts:30` and `:99`. The root tsconfig also
  includes backend sources because it has no explicit include/exclude boundary.
- Backend `tsc --noEmit --pretty false -p crawler-backend/tsconfig.json`: failed
  on the same missing `originalImageUrl` field.
- 25 tests passed across case conversion, image compression, storage utilities,
  and manifest validation after placing the temporary test cache in the writable
  workspace. An initial test attempt failed before collection due to a sandbox
  temporary-directory rename error.
- Three report property tests failed at Supabase access (`fetch failed`), before
  reaching report assertions. These tests import real database services and
  attempt database operations; they are integration tests. Other database-backed
  suites were not run. `CameraMarker.test.ts` contains a placeholder assertion.
- No crawler jobs, external AI requests, or successful live database operations
  were performed as part of indexing. End-to-end functionality remains unverified.


### Report presentation and observation safeguards � 2026-11-02
- Search print preview and browser-print fallback share `components/SearchReportDocument.tsx`; `styles/reports.css` supplies responsive preview and A4 print styling. Report timestamps explicitly use Africa/Lagos. Generated report references are not case IDs.
- Case PDF export has an escaped, styled HTML document renderer (`buildCaseReportHtml`); saved notes and provenance remain in the content. Print is triggered once.
- `utils/imageObservations.ts` separates unusable/error messages from unverified image-condition descriptions; demographic and age statements are suppressed. Age is not verified or recalibrated. Gemini prompt also excludes age; generic errors do not expose backend error messages in reports.
- No changes to Face++ search, enrollment, candidate filtering, similarity thresholds or ranking. Registered-face no-candidate issue remains unresolved; biometric identification troubleshooting was outside the assistance provided.
- Verified with mocked local tests and synthetic browser fixtures; no live enrollment, provider calls or case writes.


### Database loading investigation � 2026-11-02
- Read-only connectivity checks returned HTTP 200 for users, audit_logs and cases; data remained present. Full audit history transferred approximately 13.48 MiB for 49 rows during measurement.
- `getAuditLogs` supports metadata-only selection and an optional officer filter. Full reads remain the default for existing exports. `getAuditImage` reads one original source image by audit ID.
- History loads metadata with its existing current-officer scope; `AuditSourceImage` retrieves images only near the viewport, with a visible retry state. Dashboard loads its independent collections concurrently and applies each successful result immediately, with loading/error/retry feedback.
- Live browser verification (all database writes blocked) displayed 45 history cards for the checked administrator with no runtime errors. The user confirmed the data is showing again at http://localhost:3000/.
