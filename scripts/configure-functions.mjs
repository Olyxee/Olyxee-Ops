// Moves the organisation from four departments to the approved functional model.
//
//   node --env-file=.env scripts/configure-functions.mjs            dry run: prints the exact plan, writes nothing
//   node --env-file=.env scripts/configure-functions.mjs --apply    adds the new columns, applies the plan, reads it back
//
// Safe by construction:
//  - the four existing org_departments rows are RENAMED/RE-PARENTED, never deleted, so every assignment, lead,
//    capability scope and history row keeps pointing at the same stable id;
//  - the old department names are kept in legacy_keys, so tasks, people and objectives stored under them keep resolving;
//  - titles, employment types and reporting lines are not touched (only the function assignment and leaders change);
//  - nothing in either database is deleted, and the People database is only read;
//  - every change goes through the same audited, version-checked code the app uses;
//  - the "before" state is exported to a file first.
//
// The names below are the approved structure for this run. They are operator input to this one-off migration only:
// no application code, UI component or business rule contains a name, email or title.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectOps, connectPeople } from "../server/services/org/connect.mjs";
import { createPeopleLoader } from "../server/services/org/people-source.mjs";
import { ORG_SCHEMA_SQL } from "../server/services/org/schema.mjs";
import { applyChange, fromPgPool, getChart, getVersion, loadClassifiedPeople } from "../server/services/org/store.mjs";
import { applyFunctionsMigration } from "../server/services/org/functions-migration.mjs";

const APPLY = process.argv.includes("--apply");
const CEO_EMAIL = "scofield@olyxee.com";

// Existing departments become functions (matched by their current name).
const FUNCTIONS = [
  { from: "Engineering", name: "Technology & Engineering", legacy: ["Engineering"], order: 10,
    description: "Engineering leadership across AI research and development, data engineering and software engineering.", leader: "alisha.fatima@olyxee.com" },
  { from: "Data & Security", name: "Data Science & Intelligence", legacy: ["Data & Security"], order: 20,
    description: "Modelling, quantitative research, AI evaluation and applied intelligence.", leader: "thokozani.dlomo@olyxee.com" },
  { from: "Sales & Marketing", name: "Growth & Partnerships", legacy: ["Sales & Marketing"], order: 30,
    description: "Marketing, acquisition, outreach and partnerships.", leader: CEO_EMAIL },
];
// Specialisations inside Technology & Engineering. `from` re-uses an existing row; otherwise a new one is created.
const SPECIALISATIONS = [
  { from: "Research & Development (R&D)", name: "AI Research & Development", legacy: ["Research & Development (R&D)"], order: 11,
    description: "AI research, prototyping and applied model development.", leader: "emmanuel.stakio@olyxee.com" },
  { name: "Data Engineering", legacy: [], order: 12, description: "Data platforms, pipelines and data security.", leader: "mosa.maseko@olyxee.com" },
  { name: "Software Engineering", legacy: [], order: 13, description: "Product and platform software engineering and quality.", leader: "zaid.muhammad.dev@gmail.com" },
];
const PARENT = "Technology & Engineering";
// Who sits where. Titles and relationships are left exactly as they are.
const PLACEMENT = {
  "alisha.fatima@olyxee.com": PARENT,
  "emmanuel.stakio@olyxee.com": "AI Research & Development",
  "munibashami07@gmail.com": "AI Research & Development",
  "mosa.maseko@olyxee.com": "Data Engineering",
  "hlakotaketji@gmail.com": "Data Engineering",
  "zaid.muhammad.dev@gmail.com": "Software Engineering",
  "jaymotsweni@gmail.com": "Software Engineering",
  "thokozani.dlomo@olyxee.com": "Data Science & Intelligence",
  "abdullahsiddiqui1590@gmail.com": "Growth & Partnerships",
};

const ops = connectOps();
const peoplePool = connectPeople();
const db = fromPgPool(ops);
const loadPeople = createPeopleLoader(peoplePool);
const people = await loadClassifiedPeople(db, loadPeople);   // includes the Ops-owned employment classification
const byEmail = (email) => people.find((person) => String(person.email || "").toLowerCase() === email.toLowerCase());
const ceo = (await ops.query("SELECT id, display_name FROM public.ops_users WHERE lower(email) = $1 AND active", [CEO_EMAIL])).rows[0];
if (!ceo) throw new Error(`No active Ops account for ${CEO_EMAIL}.`);
const actor = { userId: ceo.id, name: ceo.display_name };

const existing = (await ops.query("SELECT * FROM public.org_departments WHERE active ORDER BY name")).rows;
const hasNewColumns = existing.length === 0 || "kind" in existing[0];
const row = (name) => existing.find((item) => item.name.toLowerCase() === name.toLowerCase());

// ------------------------------------------------------------------ the plan (validated before anything is written)
const problems = [];
const lines = [];
for (const fn of FUNCTIONS) {
  const found = row(fn.from) || row(fn.name);
  if (!found) problems.push(`No existing department called "${fn.from}" and none called "${fn.name}".`);
  lines.push(found && found.name !== fn.name ? `rename department "${found.name}" → function "${fn.name}" (old name kept as a legacy key)` : `keep function "${fn.name}"`);
}
for (const spec of SPECIALISATIONS) {
  const found = spec.from ? row(spec.from) || row(spec.name) : row(spec.name);
  lines.push(found ? `${found.name === spec.name ? "keep" : `convert department "${found.name}" →`} specialisation "${spec.name}" inside ${PARENT}` : `create specialisation "${spec.name}" inside ${PARENT}`);
}
for (const [email, unit] of Object.entries(PLACEMENT)) {
  const person = byEmail(email);
  if (!person) { problems.push(`No person with email ${email}.`); continue; }
  lines.push(`place ${person.name} (${person.ref}) in "${unit}" — title unchanged`);
}
for (const unit of [...FUNCTIONS, ...SPECIALISATIONS]) {
  const person = byEmail(unit.leader);
  if (!person) { problems.push(`No person with email ${unit.leader}.`); continue; }
  const ok = person.employmentType === "Employee";
  lines.push(ok ? `appoint ${person.name} as leader of "${unit.name}"` : `SKIP leader of "${unit.name}": ${person.name} is recorded as an intern (convert them to Employee first)`);
}
console.log(APPLY ? "APPLYING" : "DRY RUN — nothing will be written", `\nSchema additions needed: ${hasNewColumns ? "none (already present)" : "new columns on org_departments and the org_initiatives tables"}`);
lines.forEach((line) => console.log(" •", line));
if (problems.length) { console.log("\nPROBLEMS:"); problems.forEach((p) => console.log(" ✗", p)); }
if (!APPLY) { console.log("\nRe-run with --apply to perform these steps."); await ops.end(); await peoplePool.end(); process.exit(problems.length ? 1 : 0); }
if (problems.length) { console.log("\nRefusing to apply with problems above."); await ops.end(); await peoplePool.end(); process.exit(1); }

// ------------------------------------------------------------------ apply
const backup = path.join(os.tmpdir(), `olyxee-functions-before-${Date.now()}.json`);
const snapshot = {};
for (const table of ["org_departments", "org_assignments", "org_department_leads", "org_relationships"]) {
  snapshot[table] = (await ops.query(`SELECT * FROM public.${table}${table === "org_departments" ? "" : " WHERE effective_to IS NULL"}`)).rows;
}
fs.writeFileSync(backup, JSON.stringify(snapshot, null, 2));
console.log("\nBackup written:", backup);

await ops.query(ORG_SCHEMA_SQL);                                    // idempotent: adds only what is missing
await applyFunctionsMigration(db, loadPeople, actor, { functions: FUNCTIONS, specialisations: SPECIALISATIONS, parent: PARENT, placement: PLACEMENT }, { log: console.log });

// ------------------------------------------------------------------ read back from the database
const chart = await getChart(db, loadPeople);
const name = (ref) => chart.nodes[ref]?.name;
console.log("\nVERIFIED FROM THE DATABASE");
for (const unit of chart.departments.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))) {
  const members = Object.values(chart.nodes).filter((node) => node.departmentId === unit.id).map((node) => node.name);
  const leader = Object.values(chart.nodes).find((node) => node.leadsDepartments.includes(unit.id));
  console.log(` ${unit.parent_id ? "   └" : ""} ${unit.name} | leader: ${leader?.name ?? "—"} | members: ${members.join(", ") || "—"} | legacy keys: ${JSON.stringify(unit.legacy_keys)}`);
}
console.log("CEO is root:", chart.roots.map(name), "| issues:", JSON.stringify(chart.issues.map((issue) => issue.message)));
await ops.end();
await peoplePool.end();
