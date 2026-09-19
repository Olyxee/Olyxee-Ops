# Olyxee Ops

Run `npm run dev`. The Vite server is configured for `0.0.0.0:5000` and `allowedHosts: true`.

Authentication uses Replit-managed Clerk. Access is granted by email through the main application database, then linked to the matching person in the external staff database.

Database boundary:
- `DATABASE_URL` is the clean Olyxee Ops application database for accounts, workspace state, and asset metadata.
- `EXTERNAL_DATABASE_URL` is the existing Supabase staff database. Use it only for people, interns, managers, departments, and reporting relationships.
- Never create Olyxee Ops application tables in the external staff database.