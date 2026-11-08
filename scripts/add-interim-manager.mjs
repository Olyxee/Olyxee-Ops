// Adds a temporary stand-in for a manager who is away, and puts them in that manager's place on the chart.
//
//   node --env-file=.env scripts/add-interim-manager.mjs                  dry run: prints the plan, writes nothing
//   node --env-file=.env scripts/add-interim-manager.mjs --apply          does it and reads the result back
//   node --env-file=.env scripts/add-interim-manager.mjs --end --apply    hands everything back (the person is back)
//
// What --apply does (nothing is deleted, the away person keeps their own record):
//  1. People directory: adds the stand-in as a Manager (same access as the away manager), reporting to the CEO.
//  2. Ops: creates the login row with a random unusable password. NO email is sent from here. Send the invitation from
//     People > the person > "Create Ops login", which uses the production email settings and a single-use link.
//  3. Organisation: records the title and function, makes them lead the function, and moves the away manager's
//     direct reports to them. The away manager stays on the chart, marked Out of office, and reports to the CEO.
//  4. Gives the stand-in the same organisation capabilities and the personal calendar and agenda.
//  5. Marks the away manager "Out of office" (their own status entry only).

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { connectOps, connectPeople } from "../server/services/org/connect.mjs";
import { createPeopleLoader } from "../server/services/org/people-source.mjs";
import { ORG_SCHEMA_SQL } from "../server/services/org/schema.mjs";
import { fromPgPool, getChart, getUserCapabilities, grantCapability, loadClassifiedPeople } from "../server/services/org/store.mjs";
import { recordNewPerson } from "../server/services/org/lifecycle.mjs";
import { startCover, endCover } from "../server/services/org/cover.mjs";
import { PERSONAL_CALENDAR_SCHEMA_SQL } from "../server/services/personal-calendar/schema.mjs";
import { grantPersonalCalendar } from "../server/services/personal-calendar/store.mjs";

const APPLY = process.argv.includes("--apply");
const END = process.argv.includes("--end");
// Operator input for this one run only (no application code contains names or emails).
const CEO_EMAIL = "scofield@olyxee.com";
const AWAY_EMAIL = "alisha.fatima@olyxee.com";
const INTERIM = { email: "info@blackroid.com", name: "Interim Engineering Manager", title: "Interim Engineering Manager", department: "Engineering" };

const ops = connectOps();
const peoplePool = connectPeople();
const db = fromPgPool(ops);
const loadPeople = createPeopleLoader(peoplePool);
const q = (pool, sql, params) => pool.query(sql, params).then((r) => r.rows);
const finish = async (code = 0) => { await ops.end(); await peoplePool.end(); process.exit(code); };

const [ceoUser] = await q(ops, "SELECT id, display_name FROM public.ops_users WHERE lower(email) = $1 AND active", [CEO_EMAIL]);
const [awayUser] = await q(ops, "SELECT id, display_name FROM public.ops_users WHERE lower(email) = $1 AND active", [AWAY_EMAIL]);
if (!ceoUser || !awayUser) throw new Error("The CEO and the away manager need active Ops accounts.");
const actor = { userId: ceoUser.id, name: ceoUser.display_name };
const people = await loadClassifiedPeople(db, loadPeople);
const byEmail = (email) => people.find((p) => String(p.email || "").toLowerCase() === email);
const away = byEmail(AWAY_EMAIL);
const ceo = byEmail(CEO_EMAIL);
let interim = byEmail(INTERIM.email);
if (!away || !ceo) throw new Error("Could not find the CEO or the away manager in the directory.");

if (END) {
  console.log(APPLY ? "APPLYING" : "DRY RUN: nothing will be written");
  console.log(` - hand leadership and direct reports back to ${away.name}; remove the interim and out-of-office markers`);
  if (!APPLY) { console.log("\nRe-run with --apply."); await finish(); }
  await endCover(db, loadPeople, { actor, coveredRef: away.ref });
  const rows = await q(ops, "SELECT state_value FROM public.workspace_state WHERE state_key = 'staff-statuses'");
  const list = Array.isArray(rows[0]?.state_value) ? rows[0].state_value : [];
  const next = list.map((s) => (s.userId === away.ref && s.availability === "Out of office" ? { ...s, availability: "Available", outUntil: undefined, updatedAt: new Date().toISOString() } : s));
  await ops.query("UPDATE public.workspace_state SET state_value = $1::jsonb, updated_at = now(), updated_by = $2 WHERE state_key = 'staff-statuses'", [JSON.stringify(next), actor.userId]);
  console.log("Done. The interim account is untouched: deactivate it from People when it is no longer needed.");
  await finish();
}

const awayAccount = Number(/^account-(\d+)$/.exec(away.ref)?.[1]);
const [awayRow] = await q(peoplePool, "SELECT manage_interns, manage_projects, department, reports_to_account_id FROM public.workspace_accounts WHERE id = $1", [awayAccount]);
const chart = await getChart(db, loadPeople);
const awayNode = chart.nodes[away.ref];
const awayCaps = await getUserCapabilities(db, awayUser.id);
const led = awayNode.leadsDepartments.map((id) => chart.departments.find((d) => d.id === id)?.name);

console.log(APPLY ? "APPLYING" : "DRY RUN: nothing will be written");
console.log(` - People directory: ${interim ? `${interim.name} already exists (${interim.ref})` : `add "${INTERIM.name}" <${INTERIM.email}> as Manager (manage interns/projects: ${awayRow.manage_interns}/${awayRow.manage_projects}), stored department "${INTERIM.department}", reports to the CEO`}`);
console.log(" - Ops login: create/refresh a Manager login row with an unusable password (NO email is sent from this script)");
console.log(` - Organisation: title "${INTERIM.title}", reports to ${ceo.name}, leads ${led.join(", ") || "none"}`);
console.log(` - Direct reports moving from ${away.name} to the interim: ${awayNode.directReports.map((r) => chart.nodes[r]?.name).join(", ") || "none"}`);
console.log(` - ${away.name} stays on the chart under ${chart.nodes[awayNode.reportsTo]?.name}, marked Out of office, with the interim cover recorded`);
console.log(` - Capabilities copied from ${away.name}: ${awayCaps.map((c) => c.capability + (c.scopeDepartmentId ? " (scoped)" : "")).join(", ") || "none"}`);
console.log(" - Personal calendar and agenda: granted to the interim");
console.log(` - ${away.name}'s availability: set to Out of office (no return date)`);
if (!APPLY) { console.log("\nRe-run with --apply to do this."); await finish(); }

// 1. directory
if (!interim) {
  const inserted = await q(peoplePool,
    `INSERT INTO public.workspace_accounts (email, display_name, manage_interns, manage_projects, active, created_by, reports_to_account_id, department)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7) RETURNING id`,
    [INTERIM.email, INTERIM.name, awayRow.manage_interns, awayRow.manage_projects, CEO_EMAIL, Number(/^account-(\d+)$/.exec(ceo.ref)[1]), INTERIM.department]);
  console.log(" done: added to the People directory as", `account-${inserted[0].id}`);
  interim = { ref: `account-${inserted[0].id}` };
}
// 2. login row (no email)
const unusable = await bcrypt.hash(crypto.randomUUID(), 12);
const [interimUser] = await q(ops,
  `INSERT INTO public.ops_users (email, password_hash, display_name, role, active) VALUES ($1,$2,$3,'Manager',true)
   ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, role = 'Manager', updated_at = now() RETURNING id`,
  [INTERIM.email, unusable, INTERIM.name]);
// 3. organisation
await ops.query(ORG_SCHEMA_SQL);
await recordNewPerson(db, { actor, ref: interim.ref, title: INTERIM.title, departmentName: INTERIM.department, reportsTo: ceo.ref });
await startCover(db, loadPeople, { actor, coveringRef: interim.ref, coveredRef: away.ref, note: "while out of office" });
// 4. capabilities and calendar
for (const cap of awayCaps) {
  await grantCapability(db, { actor, userId: interimUser.id, capability: cap.capability, scopeDepartmentId: cap.scopeDepartmentId ?? null });
}
await ops.query(PERSONAL_CALENDAR_SCHEMA_SQL);
await grantPersonalCalendar(db, { userId: interimUser.id, grantedBy: ceoUser.id });
// 5. availability (only the away manager's own entry)
const rows = await q(ops, "SELECT state_value FROM public.workspace_state WHERE state_key = 'staff-statuses'");
const list = Array.isArray(rows[0]?.state_value) ? rows[0].state_value : [];
const now = new Date().toISOString();
const entry = list.find((s) => s.userId === away.ref);
const next = entry
  ? list.map((s) => (s.userId === away.ref ? { ...s, availability: "Out of office", updatedAt: now } : s))
  : [...list, { userId: away.ref, availability: "Out of office", start: "09:00", end: "17:00", note: "", updatedAt: now }];
await ops.query(
  `INSERT INTO public.workspace_state (state_key, state_value, updated_by) VALUES ('staff-statuses', $1::jsonb, $2)
   ON CONFLICT (state_key) DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
  [JSON.stringify(next), ceoUser.id]);

// read back
const after = await getChart(db, loadPeople);
const n = (ref) => after.nodes[ref]?.name;
console.log("\nVERIFIED FROM THE DATABASE");
const i = after.nodes[interim.ref];
console.log(` - ${i.name}: "${i.title}" | ${i.department} | reports to ${n(i.reportsTo)} | leads ${i.leadsDepartments.map((id) => after.departments.find((d) => d.id === id)?.name)} | covering ${n(i.covering?.ref)}`);
console.log(` - direct reports: ${i.directReports.map(n).join(", ")}`);
const a = after.nodes[away.ref];
console.log(` - ${a.name}: reports to ${n(a.reportsTo)} | leads ${a.leadsDepartments.length} | covered by ${n(a.coveredBy?.ref)} | reports ${a.directReports.length}`);
console.log(" - capabilities:", (await getUserCapabilities(db, interimUser.id)).map((c) => c.capability).join(", "));
console.log(" - issues:", JSON.stringify(after.issues.map((x) => x.message)));
console.log("\nNext: in Ops open People > the interim > Create Ops login to send the password invitation.");
await finish();
