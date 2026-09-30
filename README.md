# Olyxee Ops

Internal operating system.

## Run on Replit

Install the locked dependencies with `npm ci`, then start the existing **Start application** workflow (`npm run dev`). The Express server listens on `0.0.0.0:5000` and serves the Vite app.

Set `OPS_DATABASE_URL` and `EXTERNAL_DATABASE_URL` to the existing pooled PostgreSQL connection URLs, and set `SESSION_SECRET`, using Replit Secrets. The Ops database stores accounts, sessions, and app data; the external database supplies staff records. Both existing databases and their schemas are required for sign-in and staff data. Check `/api/health` for configuration status.

Email delivery requires the additional settings in `.env.example`. See `replit.md` for the database boundary and setup notes.