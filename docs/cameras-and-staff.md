# Cameras and workspace access

## Returning to an organization

Workspace and membership records live in Supabase. A failed access request now shows a retry screen, never a new-organization form. The selected workspace is remembered separately for each account and portal, and is checked against server membership on every load. Business creation is idempotent: an existing owner's workspace is returned rather than duplicated.

## Adding real cameras

In Cameras, choose the stream format and enter its HTTPS playback URL. HLS is supported on Chrome/Edge through HLS.js and natively on compatible Safari browsers. MJPEG is displayed as an image stream. Direct MP4/WebM remains supported. Signed URL query parameters are preserved. Expired playback URLs must be renewed at the gateway.

An IP address or RTSP URL alone is not a browser video endpoint. An RTSP/ONVIF camera needs a gateway on a network that can reach it. Configure that gateway to output HTTPS HLS using H.264 video (and AAC audio if needed), or HTTPS MJPEG. Enter that output in Lunar Vision. ONVIF is a discovery/control protocol, not a browser video format.

Choose **IP camera URL + encrypted credentials** to register the source URL, username and password in Supabase Vault. The entire connection payload, including query parameters, is encrypted. Browser-readable camera rows contain no source credentials. Existing camera managers can replace a source; passwords are not read back into the form. Replacing the source clears the old playback binding so a different camera cannot continue appearing under the old feed.

Saved sources survive logout, browser/device changes and server restarts. Source revisions, tenant access, manager roles and clearance are checked in the database. Camera deletion also deletes its Vault secret. Ordinary authenticated users, including workspace owners, cannot read the private mapping table, Vault's decrypted view, or the gateway retrieval RPC.

A trusted backend maintenance connector can retrieve a single source through `lv_camera_source_for_gateway(camera_id)` using a server-only service-role credential. Never give that credential to browsers or camera devices. The on-site service in [camera-gateway](../camera-gateway/README.md) instead uses its own workspace-scoped pairing token; it does not need a service-role key. It checks assigned RTSP sources and reports actual authentication/network/video results. Merely saving a source is still not proof of a successful connection.

Source registration and password replacement save an **unverified connection**. An incorrect password can be stored, but is not described as authenticated or connected. A paired gateway on the camera network checks it and reports **authentication failed**, **unreachable**, **invalid stream**, or **ready**. A rejected password is not retried repeatedly; replacing the saved credentials requests a new check. A VPS is optional; it cannot reach a private camera address without a VPN or equivalent private network connection.

Owners and administrators can use **Cameras → Edit camera** to change names, location, clearance, optional playback URLs, or replace the complete encrypted source and password. **Remove camera** asks for confirmation and deletes the camera, its encrypted credentials and camera settings; previously saved observations remain with their camera reference cleared. Revision checks reject stale edits/removals. Apply migration `202611130010_camera_management.sql` for these management RPCs.

Do not embed `username:password` in playback URLs, expose an unauthenticated camera on the Internet, or rely on Vercel to connect directly to a private LAN address. The gateway must enforce playback authorization; use an access-controlled same-site endpoint or expiring signed playback URLs. For HLS, allow the app origin on manifests, segments and keys via CORS. HTTPS pages require HTTPS streams.

Playback failure can mean an unsupported codec, CORS error or gateway issue. It does not prove the camera is offline. HLS recovery is bounded so a failed feed does not retry indefinitely. MJPEG supports monitoring; use an HLS/video feed for browser frame analysis. Authorized gateway feeds use camera-bound five-minute tickets, with role and clearance checks for media requests and automatic ticket renewal. Remote dashboard users need a reachable HTTPS site-gateway origin; loopback URLs are restricted to local dashboard testing. These streams open in a dedicated video viewer.

## Creating staff accounts

Organization staff / Agency personnel provides two actions:

- Manage an existing confirmed account: set role, clearance and allowed modules. The person signs in with their existing password.
- Create a staff account: verify the recipient, choose access, and generate a one-time password setup link. Share that link privately; the recipient sets their own password and then signs in at `/business` or `/agency`. No SMTP email is sent automatically. Existing accounts are never password-reset by this action.

The local API requires server-only `STAFF_SUPABASE_SERVICE_ROLE_KEY` (or the existing `SUPABASE_SERVICE_ROLE_KEY`) and a trusted `AGENCY_SETUP_ORIGIN`. Never prefix a service-role key with `VITE_`. No service-role key is sent to the browser. Account creation is restricted to workspace managers; only owners or agency platform administrators can grant the administrator role.

## Roles and clearance

Viewers are read-only. Operators, investigators and supervisors have their existing operational role limits. Owners and administrators manage staff and configuration and have full module access. Other staff can be assigned monitor, analytics, records, evidence or vehicle modules independently.

Clearance runs from 0 (General), 1 (Internal), 2 (Restricted) to 3 (Confidential). Cameras and records can carry a minimum clearance. Referenced observations, alerts and evidence inherit access restrictions from their camera or record. Supabase policies protect direct reads, storage downloads and definer-RPC writes. Managers cannot grant clearance above their own, alter their own membership, or modify a protected owner account.

Existing memberships retain their access when the migration is applied. New staff default to clearance 0 and monitoring only. Module settings do not grant access to a different organization.

Validation: `node tests/workspace-access.integration.mjs` and `npx vitest run api/staff-accounts.test.ts components/CameraStream.test.tsx pages/WorkspacePortal.test.tsx`.
