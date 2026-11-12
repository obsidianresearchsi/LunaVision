# LunarVision site camera gateway

This service runs on a computer that can reach the cameras. It authenticates real RTSP/RTSPS sources, reports connection results to Supabase, and produces browser video only while authorized viewers request it. Camera sources and passwords are not returned to the dashboard. This service does not perform face identification or other video analytics.

## This PC

The local setup uses a Windows-user-encrypted `.env.camera-gateway.dpapi` configuration. Start it from the project directory with `npm run gateway`. Its health endpoint is `http://127.0.0.1:8787/healthz`. It is restricted to the paired workspace and camera subnet configured during installation. No Supabase service-role or management key is needed by the running gateway.

The local gateway listens only on this PC. Use the local dashboard at `http://localhost:3000/agency` or `http://127.0.0.1:3000/agency`. A hosted dashboard cannot turn a loopback address into a remotely reachable feed.

The PC must stay on, awake, connected to the camera network and connected to Supabase. The current foreground service does not install a Windows startup task. For daily use, deploy it as a supervised service on an always-on site computer. Do not rely on an operator's laptop remaining available.

## Another site

1. A workspace owner or administrator opens Cameras → Site gateways → Pair a site gateway. Set its name, secure playback address and camera network, then download the private setup file once. Pairing attaches eligible unassigned sources; subsequent cameras use the only eligible gateway automatically. With multiple gateways, use Edit camera → Site gateway to assign the correct site.
2. Install Node.js and FFmpeg/FFprobe on that site's computer. Keep the JSON setup file private and outside published/static folders. Set `LUNAR_GATEWAY_CONFIG` to its absolute path, ensure `ffmpeg` and `ffprobe` in that file resolve to installed executables, and run `npm run gateway`.
3. The gateway's `networks` setting is an explicit ingress allowlist, currently IPv4 CIDRs and RTSP/RTSPS sources. Hostname, raw HTTP/MJPEG and out-of-network sources are rejected with a visible unsupported-source result. Existing HTTPS HLS/MJPEG playback URLs remain available through the dashboard's direct playback option. RTSPS certificate verification is enabled.
4. Replace wrong credentials using Edit camera. A rejected login is not retried in a loop: changing the saved source revision triggers a new check. Unreachable cameras retry with bounded exponential delay. The gateway never scans the local network.

Pairing stores only a SHA-256 token hash in Supabase. Gateway tokens are restricted to their workspace, assigned cameras and the pairing manager's clearance. Disable a gateway from the dashboard to revoke it; reconnect it by pairing a new credential. If a setup file is lost, pair a new gateway rather than retrieving the old secret.

## Remote dashboard viewers

Remote users need a reachable **HTTPS** gateway endpoint. Put a TLS reverse proxy or authenticated outbound tunnel in front of the gateway's loopback listener and register that stable origin. A VPN is another option when viewers can join the site network and use a trusted HTTPS endpoint. A VPS is optional: it can host the relay/control layer and connect to sites over a VPN. Merely deploying the dashboard to Vercel does not expose a site camera address.

Do not forward camera RTSP ports directly to the public Internet. Do not publish a bare unprotected media directory. Forward requests to the gateway HTTP service so every playlist and segment passes its authorization checks. Disable proxy/CDN caching and request-query logging for media routes; query strings contain short-lived viewer tickets. Restrict the public route to the gateway service and keep administration on the dashboard.

For an approved Cloudflare Tunnel that connects to the loopback listener, set `trustCloudflare: true` in the private configuration. Only loopback proxy requests may then supply Cloudflare's client-address header for rate limiting; direct network clients cannot spoof it. A temporary Quick Tunnel changes hostname on restart and has no uptime guarantee. This installation uses one only for the approved testing session; no automatic public-tunnel startup is installed.

The application issues five-minute camera-bound tickets only after checking workspace membership, monitoring scope and clearance. The gateway rechecks those permissions during playback, with a three-second authorization cache. Changing source credentials or gateway assignment invalidates previous access. Stream tickets are renewed by the open viewer before expiry. Site credentials and camera passwords are never part of playback URLs.

Local loopback endpoints are deliberately rejected when opened from a hosted dashboard. Remote viewing is not configured by this local installation; a secure public address or VPN must be provided separately.

## Capacity and operation

A Linux VPS can run the service with the unit and installer under `camera-gateway/deploy`. Install Node.js 20 or newer, npm and FFmpeg, unpack a gateway-only release under `/opt/lunavision-gateway`, and place its private pairing JSON at `/etc/lunavision-gateway/config.json`. The installer runs the service under a dedicated account with a read-only application directory and a private media directory. It does not install a VPN, expose RTSP ports, or modify an existing WireGuard interface. The VPS still needs a private route through a device at the camera site before it can ingest a private camera address.

The initial configuration allows four simultaneous camera ingests, shared between viewers watching the same camera. Only two connection probes run concurrently. Idle ingests stop after 60 seconds. H.264 video is remuxed without decoding; other supported video is transcoded to H.264 with bounded threads. Audio is off. Segments are short-lived files in the ignored `.vercel/camera-gateway-media` folder and are removed when streams close. Stop/restart the service after changing its configuration.

Start with one gateway per camera site. Camera capacity depends on resolution, bitrate, codec, available upload bandwidth, PC hardware, and concurrent viewers; this implementation has not been load-tested for a specific fleet size. For larger fleets, benchmark each site and add gateway hosts rather than assigning all sites to one operator PC. Gateway status, credential validation and camera settings are separate: saving a source does not prove a successful login, and a successful probe does not prove that every remote viewer can reach the site endpoint.

Workspace owners and administrators can mark a default test camera. It is persisted in Supabase, sorted first in Cameras and selected initially in Camera Intelligence; camera clearance still applies. Each workspace has at most one default.

The dedicated gateway viewer supports non-identifying person and vehicle presence alerts. It samples actual playing video, requires consecutive detections, applies a per-camera confidence threshold, and saves only camera/source-bound observations. The database enforces role, clearance, source verification, cooldown and idempotency checks. Other authorized dashboards receive the persisted presence alerts by polling. Processing currently runs in the visible browser while the feed is playing; a continuously running server-side inference worker is not included. Face identification or face-watchlist matching is not part of this pipeline.

## Verification

- `node --test camera-gateway/gateway.integration.mjs` tests protected manifests/segments, origin restrictions, concurrent ingest sharing, source replacement, revocation, network allowlisting and capacity limits.
- `node tests/workspace-access.integration.mjs` tests database isolation, pairing permissions, private token hashes, credential scope, expiring tickets, role/clearance enforcement, source edits and secure removal. Its local Vault stub tests logic; real Vault encryption is checked against Supabase separately.
- `node camera-gateway/rtsp-smoke.mjs` uses portable test binaries under `.vercel/camera-runtime`, publishes existing practice footage to an isolated loopback RTSP fixture, verifies correct/incorrect camera credentials, and produces actual HLS segments. It creates no operational camera records.

FFmpeg binaries should come from the FFmpeg project's linked distributors and be checksum-verified. The isolated MediaMTX fixture is a test dependency, not part of the running site gateway.
