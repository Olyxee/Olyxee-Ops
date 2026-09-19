# Olyxee Ops

Run `npm run dev`. The Vite server is configured for `0.0.0.0:5000` and `allowedHosts: true`.

Authentication uses secure database-backed sessions in the clean Ops Supabase database. Passwords are stored only as bcrypt hashes.

Database boundary:
- `OPS_DATABASE_URL` is the clean Olyxee Ops Supabase database for accounts, sessions, workspace state, and asset metadata.
- `EXTERNAL_DATABASE_URL` is the existing Supabase staff database. Use it only for people, interns, managers, departments, and reporting relationships.
- Never create Olyxee Ops application tables in the external staff database.