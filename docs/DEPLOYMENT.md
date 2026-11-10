# Deploy Lunar Vision to Vercel

1. Import the GitHub repository into Vercel. Select the repository root and the Vite preset.
2. Add your public Mapbox token as `VITE_MAPBOX_ACCESS_TOKEN` for Preview and Production. Without it, the demo map uses CARTO. Use a token that allows requests from your deployment domain.
3. Deploy. The checked-in Vercel configuration installs dependencies, builds the Vite app in `vercel` mode and publishes `dist`.
4. Open **Explore design preview** to check the Command Centre, North Gate layers, and desktop and mobile navigation.

The Vercel build serves the fictional Meridian Port workspace. The existing local sign-in is a demo username lookup and is disabled in this build. Connecting a hosted deployment to workspace records requires a separate production authentication and authorization setup.

For local development, copy `.env.example` to `.env.local` and run `npm ci` followed by `npm run dev`. Supply `VITE_SUPABASE_URL` and the browser-safe `VITE_SUPABASE_ANON_KEY` to enable the existing local workspace. Keep database service keys and provider secrets out of all `VITE_` variables.

The optional `crawler-backend/` is a separate Express service. Vercel builds only the frontend. Local users can set `VITE_CRAWLER_API_URL` to an independently hosted or local crawler endpoint.
