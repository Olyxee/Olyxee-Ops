import pg from "pg";

// Same connection settings as server.mjs so scripts behave like the app.
export function connectOps(url = process.env.OPS_DATABASE_URL) {
  if (!url) throw new Error("OPS_DATABASE_URL is required.");
  const value = new URL(url);
  if (value.hostname.includes("pooler.supabase.com") && value.port === "5432") value.port = "6543";
  return new pg.Pool({ connectionString: value.toString(), ssl: { rejectUnauthorized: false }, max: 2 });
}
export function connectPeople(url = process.env.EXTERNAL_DATABASE_URL) {
  if (!url) throw new Error("EXTERNAL_DATABASE_URL is required.");
  return new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });
}
