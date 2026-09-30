# Olyxee Ops

Run `npm ci` to install the locked dependencies, then use the existing **Start application** workflow (`npm run dev`). The Node/Express server listens on `0.0.0.0:5000` and serves Vite in development with `allowedHosts: true`. Check `/api/health` for configuration status.

Authentication uses secure database-backed sessions in the clean Ops Supabase database. Passwords are stored only as bcrypt hashes.

Database boundary:
- Set `OPS_DATABASE_URL` and `EXTERNAL_DATABASE_URL` as Replit Secrets using the existing pooled PostgreSQL connection URLs. Without them, the sign-in page loads but authentication and staff data are unavailable. The Ops database must have the application's existing schema, including the session table.
- `SESSION_SECRET` is also required for database-backed authentication.
- `OPS_DATABASE_URL` is the clean Olyxee Ops Supabase database for accounts, sessions, workspace state, and asset metadata.
- `EXTERNAL_DATABASE_URL` is the existing Supabase staff database. Use it only for people, interns, managers, departments, and reporting relationships.
- Never create Olyxee Ops application tables in the external staff database.

Email delivery is separate from basic app startup. The `.env.example` lists its additional settings; don't configure live email in development without the intended sender and Resend credentials.