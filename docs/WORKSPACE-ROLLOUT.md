# Workspace rollout

The public homepage introduces the business workspace and links to sign-in and registration at /business. The agency and platform administration routes have separate sign-in entry points. The route name does not grant access. Supabase Auth authenticates the account and database policies authorize workspace operations.

Apply the workspace, camera, legacy quarantine, record status, vehicle watchlist and workspace governance migrations in order. The quarantine preserves the legacy rows and keeps the old mugshots bucket private. Check the existing schema and migration history before applying scripts to an existing project.

Use Supabase Auth to invite and confirm individual agency accounts. Platform administrators can create agencies, assign confirmed accounts as agency administrators or members, change the access entitlement label, suspend or restore agencies, and review administrative activity at /agency/admin. Workspace administrators can manage ordinary members in their own agency. The entitlement label is administrative metadata. Automatic billing and usage metering require separate integrations.

Business users register through /business, confirm their email, and create an organization. The organization owner and administrators can update organization details and manage staff under the same role boundaries. Configure SMTP and the exact Auth redirect URLs before opening enrollment. Supabase Auth retains the account and login logs. The in-app audit records workspace access, agency status and configuration changes.

Migration 202611100008 adds corrective actions to business incident records. Each action has a responsible team and due date, and the database records who completed it and when.

Workspace cameras use direct HTTPS browser-playable endpoints. The workspace shows the browser's playback state when a feed is opened. The camera gateway must allow cross-origin frame access for object detection and OCR. Workspace analysis accepts registered feeds, local uploads and explicitly selected practice footage. Apply 202611100007 to enable saved observations. Operators can save object labels, scores and frame times from a registered camera or local upload. Workspace Overview shows the records from Supabase. The bundled samples cannot create observations, and saving an observation does not upload the underlying video. RTSP, background processing, notifications and long-term playback require a separate camera gateway or event pipeline.

Open /video-analysis for the bundled samples or upload a local video. The traffic example uses the Wikimedia Commons 480p VP9 transcode of [Street traffic by Editor](https://commons.wikimedia.org/wiki/File:Street_traffic.webm), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The OCR sample is a resized copy of [Nigerian number plate Niger by Niegodzisie](https://commons.wikimedia.org/wiki/File:Nigerian_number_plate_Niger.jpg), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The browser downloads model assets and processes footage locally.

Agency personnel can add Nigerian vehicle plates with a case reference, close active entries, and look up a verified plate from local video or a registered camera. Matching is exact after normalization. It is an operator-initiated lookup. Public samples cannot query the agency watchlist.

The original EagleEye face search, crawler, legacy case screens and provider calls require tenant migration before they can be exposed through the new portals. No demo organizations, users or events are seeded.
