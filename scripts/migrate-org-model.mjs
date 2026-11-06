// Organisational model migration.
//
//   node --env-file=.env scripts/migrate-org-model.mjs                 dry run (default): reads, reports, writes nothing
//   node --env-file=.env scripts/migrate-org-model.mjs --apply         creates org_* tables in the OPS database and seeds them
//   ... --link intern-4=account-1 --exclude account-11="Technical administration account" --supervisor intern-9=account-2
//                                                                      confirm specific judgement calls (applied only with --apply)
//   node --env-file=.env scripts/migrate-org-model.mjs --rollback --export org-backup.json
//                                                                      exports the org_* data, then drops the org_* tables
//
// The People database is only ever READ. Legacy reporting columns are left exactly as they are.
import fs from "node:fs";
import { ORG_DROP_SQL, ORG_SCHEMA_SQL } from "../server/services/org/schema.mjs";
import { connectOps, connectPeople } from "../server/services/org/connect.mjs";
import { readLegacyRelations } from "../server/services/org/people-source.mjs";
import { planSeed } from "../server/services/org/seed.mjs";
import { applySeed } from "../server/services/org/seed-apply.mjs";
import { fromPgPool } from "../server/services/org/store.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
const pairs = (name) => Object.fromEntries(values(name).map((item) => {
  const at = item.indexOf("=");
  if (at < 1) throw new Error(`${name} expects ref=value, got "${item}"`);
  return [item.slice(0, at), item.slice(at + 1)];
}));

const ops = connectOps();
const db = fromPgPool(ops);

try {
  if (flag("--rollback")) {
    const target = values("--export")[0];
    if (!target) throw new Error("--rollback requires --export <file> so nothing is lost.");
    const tables = ["org_state", "org_departments", "org_positions", "org_changes", "org_assignments", "org_relationships",
      "org_department_leads", "org_identity_links", "org_chart_exclusions", "org_capabilities", "org_proposals"];
    const dump = {};
    for (const table of tables) dump[table] = (await ops.query(`SELECT * FROM public.${table}`)).rows;
    fs.writeFileSync(target, JSON.stringify(dump, null, 2));
    console.log(`Exported ${tables.length} tables to ${target}`);
    await ops.query(ORG_DROP_SQL);
    console.log("Dropped org_* tables. People database and legacy columns were not touched.");
  } else {
    const people = connectPeople();
    const legacy = await readLegacyRelations(people);
    const opsUsers = (await ops.query("SELECT email, role FROM public.ops_users")).rows;
    await people.end();
    const accept = { links: pairs("--link"), exclusions: pairs("--exclude"), supervisors: pairs("--supervisor") };
    const plan = planSeed({ ...legacy, opsUsers }, accept);
    const nameOf = (ref) => {
      const [kind, id] = ref.split("-");
      return (kind === "account" ? legacy.accounts.find((a) => String(a.id) === id)?.display_name : legacy.interns.find((i) => String(i.id) === id)?.full_name) || ref;
    };
    const label = (ref) => `${ref} (${nameOf(ref)})`;

    console.log(`\nWould seed: ${plan.departments.length} departments, ${plan.assignments.length} title records, ${plan.relationships.length} relationships, ${plan.links.length} identity links, ${plan.exclusions.length} exclusions.`);
    console.log("\nNeeds your confirmation (NOT applied unless named on the command line):");
    for (const c of plan.pendingConfirmation.identityLinks) console.log(`  same person twice : --link ${c.supersededRef}=${c.canonicalRef}   ${label(c.supersededRef)} -> ${label(c.canonicalRef)} (evidence: ${c.via})`);
    for (const t of plan.pendingConfirmation.technicalAccounts) console.log(`  technical manager : --exclude ${t.managerRef}="Technical administration account"   manages ${t.reports.map(label).join(", ")}`);
    for (const s of plan.pendingConfirmation.supervisors) console.log(`  supervisor guess  : --supervisor ${s.internRef}=${s.proposed}   ${label(s.internRef)} -> ${label(s.proposed)} (via ${s.via})`);
    if (plan.review.departmentFallback.length) console.log(`  no supervisor data: ${plan.review.departmentFallback.map(label).join(", ")} (nothing guessed; assign in Ops)`);
    if (plan.review.inconsistentStatus.length) console.log(`  status mismatch   : ${plan.review.inconsistentStatus.map(label).join(", ")} are Active but past their completion date`);
    console.log(`  completed interns : ${plan.review.completedInterns.map(label).join(", ") || "none"} (hidden from the chart by status)`);
    console.log(`  employee titles   : ${plan.review.unsetTitles.length} employees will show "Title not set" until set in Ops`);

    if (!flag("--apply")) {
      console.log("\nDRY RUN: nothing was written. Re-run with --apply to create the tables and seed them.");
    } else {
      await ops.query(ORG_SCHEMA_SQL);
      const counts = await applySeed(db, plan);
      console.log("\nApplied:", counts);
    }
  }
} finally {
  await ops.end();
}
