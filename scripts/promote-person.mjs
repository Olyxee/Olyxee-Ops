// Makes a person an Employee with a Manager login (so they get the manager workspace), without touching the People database.
//
//   node --env-file=.env scripts/promote-person.mjs --email zaid.muhammad.dev@gmail.com            dry run
//   node --env-file=.env scripts/promote-person.mjs --email zaid.muhammad.dev@gmail.com --apply    do it
//
// 1. Employment: recorded in the Ops-owned classification through the audited organisation change (history, version check).
// 2. Access: the Ops login role becomes Manager. Who they manage still comes from the organisation (reporting lines,
//    internship supervision and the teams they lead), not from this role.
// Nothing is deleted. Reverse it by setting employment back to Intern and the role back to Member.

import { connectOps, connectPeople } from "../server/services/org/connect.mjs";
import { createPeopleLoader } from "../server/services/org/people-source.mjs";
import { applyChange, fromPgPool, getChart, getVersion, loadClassifiedPeople } from "../server/services/org/store.mjs";

const arg = (name) => { const index = process.argv.indexOf(name); return index > -1 ? process.argv[index + 1] : undefined; };
const email = String(arg("--email") || "").trim().toLowerCase();
const APPLY = process.argv.includes("--apply");
const CEO_EMAIL = "scofield@olyxee.com";
if (!email) { console.log("Usage: --email <address> [--apply]"); process.exit(1); }

const ops = connectOps();
const peoplePool = connectPeople();
const db = fromPgPool(ops);
const loadPeople = createPeopleLoader(peoplePool);
const finish = async (code = 0) => { await ops.end(); await peoplePool.end(); process.exit(code); };

const [ceo] = (await ops.query("SELECT id, display_name FROM public.ops_users WHERE lower(email) = $1 AND active", [CEO_EMAIL])).rows;
const [login] = (await ops.query("SELECT id, role, active FROM public.ops_users WHERE lower(email) = $1", [email])).rows;
const people = await loadClassifiedPeople(db, loadPeople);
const person = people.find((item) => String(item.email || "").toLowerCase() === email);
if (!ceo || !login?.active || !person) { console.log("Need the CEO account, an active Ops login and a directory entry for this email. Nothing changed."); await finish(1); }

console.log(APPLY ? "APPLYING" : "DRY RUN: nothing will be written");
console.log(` - ${person.name} (${person.ref}): employment ${person.employmentType} -> Employee`);
console.log(` - Ops login role: ${login.role} -> Manager`);
if (!APPLY) { console.log("\nRe-run with --apply to do this."); await finish(); }

const actor = { userId: ceo.id, name: ceo.display_name };
if (person.employmentType !== "Employee") {
  await applyChange(db, loadPeople, { actor, expectedVersion: await getVersion(db), input: { subjectRef: person.ref, employmentType: "Employee", reason: "Team lead: moved from intern to employee" } });
}
await ops.query("UPDATE public.ops_users SET role = 'Manager', updated_at = now() WHERE id = $1", [login.id]);

const after = (await loadClassifiedPeople(db, loadPeople)).find((item) => item.ref === person.ref);
const chart = await getChart(db, loadPeople);
const node = chart.nodes[person.ref];
console.log("\nVERIFIED FROM THE DATABASE");
console.log(` - employment: ${after.employmentType}`);
console.log(` - login role: ${(await ops.query("SELECT role FROM public.ops_users WHERE id = $1", [login.id])).rows[0].role}`);
console.log(` - title: ${node?.title} | team: ${node?.department} | reports to: ${chart.nodes[node?.reportsTo]?.name ?? chart.nodes[node?.internSupervisor]?.name ?? "none"} | direct reports: ${(node?.directReports || []).concat(node?.supervisedInterns || []).map((ref) => chart.nodes[ref]?.name).join(", ") || "none"}`);
console.log(" - issues:", JSON.stringify(chart.issues.map((issue) => issue.message)));
await finish();
