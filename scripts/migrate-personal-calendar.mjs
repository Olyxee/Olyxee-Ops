// Adds the CEO's personal calendar table to the Ops database.
//
//   node --env-file=.env scripts/migrate-personal-calendar.mjs          dry run: reports what exists, writes nothing
//   node --env-file=.env scripts/migrate-personal-calendar.mjs --apply  creates the table if it is missing
//
// One new table, additive and idempotent. No existing table or row is changed, and the People database is not used.
// Until it has run, the dashboard shows the calendar and agenda cards as "not set up yet".

import { connectOps } from "../server/services/org/connect.mjs";
import { PERSONAL_CALENDAR_SCHEMA_SQL } from "../server/services/personal-calendar/schema.mjs";

const APPLY = process.argv.includes("--apply");
const ops = connectOps();
const exists = async (name) => (await ops.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${name}`])).rows[0].ok;

console.log(APPLY ? "APPLYING" : "DRY RUN — nothing will be written");
console.log(` • personal_calendar_events: ${(await exists("personal_calendar_events")) ? "already exists" : "will be created"}`);
if (!(await exists("ops_users"))) { console.log("\nMissing prerequisite table: ops_users. Nothing changed."); await ops.end(); process.exit(1); }
if (!APPLY) { console.log("\nRe-run with --apply to create it."); await ops.end(); process.exit(0); }

await ops.query(PERSONAL_CALENDAR_SCHEMA_SQL);
console.log("\nVERIFIED");
console.log(` • personal_calendar_events: ${(await exists("personal_calendar_events")) ? "present" : "MISSING"}`);
console.log(" • events stored:", (await ops.query("SELECT count(*)::int n FROM public.personal_calendar_events")).rows[0].n);
await ops.end();
