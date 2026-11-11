# Agency operations

Agency users enter at `/agency`. Membership and workspace suspension are enforced by Supabase; hiding a menu is not the access control. Only agency owners and administrators can edit devices and detection rules. The existing sidebar and styling are retained.

## Object detection and rules

1. Register a browser-compatible HTTPS camera endpoint in Live cameras, or select a local video in Playback.
2. In AI rules, create a rule for a supported object class, confidence threshold and priority. Set a repeat-alert cooldown between 15 and 3,600 seconds. Rules can be edited or disabled.
3. Open the camera analysis or uploaded video. Enable **Save detections automatically every 15 seconds** and play the video. Manual frame saving remains available.
4. Each saved observation is evaluated by a database trigger. Matching rules create alerts. A rule's cooldown applies independently to each camera. Uploaded files share a separate cooldown for that rule.
5. Open Alerts to acknowledge, resolve or reopen the resulting alert. Saved observations remain available in Detection history.

Processing runs in the browser while the tab is visible and playback is active. It stops when the tab closes. This deployment does not include an always-on camera gateway, RTSP transcoder or server inference worker. Built-in practice samples cannot create operational observations. A sample deliberately uploaded as a file during QA is confined to the test agency and removed afterward.

Observation saves carry a stable request identifier. If the acknowledgement is lost, retrying the pending frame returns the original saved record rather than creating another observation or alert. A failed save pauses automatic saving until the operator retries it. Browser model confidence is not a verified security finding; operators must review the footage.

## Evidence

Evidence must reference an investigation in the same agency. Search investigation titles to find older records. JPEG, PNG, PDF and MP4 files up to 25 MB are accepted.

Files go into a private bucket under the agency and uploader's identifiers. Registered files cannot be overwritten or deleted by application users. The browser computes SHA-256 before upload and compares it again before downloading; the upload hash is supplied by the client, not independently certified by the server.

If an upload or registration response is lost, use **Retry evidence registration**. The original file path and metadata are reused, and an already committed registration returns the same record. Keep the page open until confirmation: unfinished local uploads are not recoverable across a browser restart. Access suspension also blocks evidence retrieval.

## Device edits and connection checks

Device and rule edits include the revision originally loaded by the operator. A stale edit is rejected with a refresh instruction. Device registration is not an online-health indication. Playback must be checked against the actual camera or gateway.

Integrations verifies workspace database access, counts registered endpoints and saved observations, and requests an actual Mapbox tile with a bounded timeout. It displays the check time and reports tile failures rather than treating a configured token as a healthy connection.

## Validation

Run `npm run test:agency` for isolated PostgreSQL tests covering agency isolation, manager privileges, edit conflicts, alert transitions, cooldowns, retry idempotency, immutable evidence, upload metadata checks and suspended access. Run `npx tsc --noEmit` and `npm run build -- --mode vercel` sequentially.

Live QA uses the dedicated test agency, removes its temporary accounts, records and files, and retains the real audit events in that test agency. No operational agencies need seeded sample records.

Biometric enrollment, saved facial-search history and web-based face collection remain unavailable. They are not represented as completed integrations.
