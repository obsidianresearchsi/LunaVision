# Platform update screen

The full-screen maintenance presentation is enabled by default on every frontend route, including `/`, `/agency`, `/agency/admin`, `/business`, `/bussiness`, and `/video-analysis`. Normal routes are lazy-loaded only when maintenance is disabled, so dashboards and their data subscriptions do not mount behind the screen.

Progress is simulated: it advances from 0 to 99 over five minutes, then stays at 99 with a finalizing indicator. This does not download files or perform a system update. The start time is stored per browser and retained across refreshes and route changes. Browsers that block storage still show progress for the current visit.

To restore normal access, set the public build variable `VITE_PLATFORM_UPDATE_ENABLED=false` in Vercel for the intended environment and redeploy. Use the same variable in `.env.local` and restart Vite for local access. There is no URL bypass. Supabase records, authentication sessions, backend APIs, and camera gateway configuration are unchanged; the screen is a frontend presentation, not a replacement for backend authorization.
