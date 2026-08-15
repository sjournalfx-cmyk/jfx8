# Setup

## Prerequisites
- **Node.js**: Version 18+ (check with `node --version`).
- **Supabase Account**: Sign up at supabase.com for database and auth.
- **API Keys**:
  - NVIDIA API key from NVIDIA Build (server-side, used by the `/api/nvidia` proxy).
  - OpenAI API key (server-side, used by `/api/transcribe` for voice notes).
  - Supabase project URL and anon key.

## Installation
1. Clone or download the project.
2. Install dependencies:
   ```
   npm install
   ```

## Environment Configuration
1. Copy `.env.example` to `.env.local`.
2. Set variables — **client-safe** values (public by design):
   ```
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_CTRADER_CLIENT_ID=your_ctrader_client_id
   ```
3. Set **server-side** keys (never `VITE_*` — they would be bundled into the browser):
   ```
   NVIDIA_API_KEY=your_nvidia_key_here
   OPENAI_API_KEY=your_openai_api_key
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   CTRADER_CLIENT_ID=your_ctrader_client_id
   CTRADER_CLIENT_SECRET=your_ctrader_client_secret
   ```
4. For Vercel deployments, add the server-side keys above to the project's Environment Variables.

## Database Setup
1. Create a new Supabase project.
2. Run SQL migrations in order (from `add_trade_duration_columns.sql` etc.):
   - Tables: trades, profiles, notes, goals, daily_bias, ea_sessions.
   - Enable real-time for trades_sync, profile_sync, etc.
3. Configure authentication providers if needed.

## Running Locally
1. Start dev server:
   ```
   npm run dev
   ```
2. Open http://localhost:5173 (default Vite port).
3. Verify: Login, add a test trade, check real-time sync.

## Testing
- **Manual Testing**: Log in, create/edit trades, view analytics, toggle themes.
- **Integration**: Test cTrader sync (requires cTrader Open API app credentials), CSV export.
- **AI Features**: Ensure the NVIDIA API key is set server-side for AI insights (e.g., in notes).

## Troubleshooting
- **API Key Errors**: Check `.env.local` keys and Supabase project settings; server-side keys must be present in the Vercel environment for production.
- **Sync Failures**: Verify Supabase real-time enabled; check browser console for errors.
- **Build Issues**: Run `npm run build` and check output for TypeScript errors.