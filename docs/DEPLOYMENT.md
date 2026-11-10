# Deploy Lunar Vision to Vercel

Import the Lunar Vision GitHub repository as a Vite project. The checked-in Vercel configuration builds in vercel mode and serves dist. Apply the workspace migrations in order before enabling the workspace routes on a new database. On an existing database, inspect the migration history first.

Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the project's public browser settings. Set VITE_WORKSPACE_PORTAL_ENABLED=true to connect the portal to Supabase. Keep the service role key and provider secrets server-side.

Allow the deployed origin and the exact /business, /agency, and /agency/admin routes in Supabase Auth redirect settings. Password sign-in works for confirmed accounts. Email confirmation, invitations and recovery require email delivery.

For sign-in without email delivery, configure Google OAuth in Supabase Auth with a Google Cloud OAuth client. Set VITE_GOOGLE_SIGN_IN_ENABLED=true and, for a rollout that uses Google for new accounts, set VITE_EMAIL_AUTH_FLOWS_ENABLED=false to hide email registration and recovery. Keep email confirmation enabled in Supabase. Agency access still requires a membership or platform administrator assignment after the account signs in. Password-only accounts can continue to sign in with an existing password.

To enable agency face comparison and uploaded gallery search, set FACEPP_API_KEY and FACEPP_API_SECRET as server-only Vercel environment variables, then set VITE_FACE_COMPARISON_ENABLED=true. The endpoint verifies active agency membership before forwarding two photos to Face++. Gallery search compares up to six operator-selected photos using this endpoint and ranks the results.

To enable account issuance, set SUPABASE_SERVICE_ROLE_KEY and AGENCY_SETUP_ORIGIN as server-only Vercel variables. Use the trusted HTTPS deployment origin and allow its exact /agency callback in Supabase Auth. The platform administrator must verify the recipient before creating the account. Supabase generates a one-time recovery link without sending email. Share it only through the agency's approved channel. Existing accounts can be assigned through Personnel access.

- / is the public business entry point.
- /business supports self-registration and the authenticated organization workspace.
- /agency is the agency sign-in and operational workspace.
- /agency/admin requires platform administrator authorization.
- /video-analysis runs local inference and has separate licensed test assets.

For local development, set the same public variables in .env.local and run npm run dev. Enable the workspace flag only when the configured project has the required schema.

The original EagleEye pages remain in source. They require tenant-scoped data, storage and provider integration before they can be connected to a portal. The crawler backend is a separate service and is not part of the Vercel frontend.
