// Gives (or takes away) a personal calendar and agenda for one Ops account. The CEO always has one.
//
//   node --env-file=.env scripts/grant-personal-calendar.mjs --email alisha.fatima@olyxee.com            dry run
//   node --env-file=.env scripts/grant-personal-calendar.mjs --email alisha.fatima@olyxee.com --apply    grant it
//   node --env-file=.env scripts/grant-personal-calendar.mjs --email alisha.fatima@olyxee.com --revoke --apply
//
// Additive and idempotent. --apply first makes sure the two calendar tables exist (CREATE ... IF NOT EXISTS), then
// records the grant. Each person only ever sees their own events, and revoking keeps the saved events.

import { connectOps } from "../server/services/org/connect.mjs";
import { PERSONAL_CALENDAR_SCHEMA_SQL } from "../server/services/personal-calendar/schema.mjs";
import { fromPgPool } from "../server/services/org/store.mjs";
import { grantPersonalCalendar, hasPersonalCalendarAccess, revokePersonalCalendar } from "../server/services/personal-calendar/store.mjs";

const arg = (name) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : undefined; };
const email = String(arg("--email") || "").trim().toLowerCase();
const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");
if (!email) { console.log("Usage: --email <address> [--revoke] [--apply]"); process.exit(1); }

const pool = connectOps();
const db = fromPgPool(pool);
const account = (await pool.query("SELECT id, display_name, role, active FROM public.ops_users WHERE lower(email) = $1", [email])).rows[0];
if (!account?.active) { console.log(`No active Ops account for ${email}. Nothing changed.`); await pool.end(); process.exit(1); }
const ceo = (await pool.query("SELECT id FROM public.ops_users WHERE role = 'Superadmin' AND active AND lower(email) = 'scofield@olyxee.com'")).rows[0];
const tableExists = (await pool.query("SELECT to_regclass('public.personal_calendar_access') IS NOT NULL AS ok")).rows[0].ok;
const already = tableExists && (await hasPersonalCalendarAccess(db, account.id));

console.log(APPLY ? "APPLYING" : "DRY RUN — nothing will be written");
console.log(` • account: ${account.display_name} (${account.role})`);
console.log(` • access table: ${tableExists ? "exists" : "will be created"}`);
console.log(` • currently has a personal calendar: ${already ? "yes" : "no"}`);
console.log(` • will: ${REVOKE ? "revoke it (saved events are kept)" : already ? "leave as is" : "grant it"}`);
if (!APPLY) { console.log("\nRe-run with --apply to do this."); await pool.end(); process.exit(0); }

await pool.query(PERSONAL_CALENDAR_SCHEMA_SQL);
if (REVOKE) await revokePersonalCalendar(db, { userId: account.id });
else await grantPersonalCalendar(db, { userId: account.id, grantedBy: ceo?.id ?? null });
console.log("\nVERIFIED FROM THE DATABASE");
console.log(` • ${account.display_name} has a personal calendar:`, await hasPersonalCalendarAccess(db, account.id));
await pool.end();
