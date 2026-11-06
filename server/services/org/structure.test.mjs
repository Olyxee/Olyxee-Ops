import assert from "node:assert/strict";
import test from "node:test";
import { applyChange, getChart, getVersion } from "./store.mjs";
import { createFunction, createInitiative, listInitiatives, updateFunction, updateInitiative } from "./structure.mjs";
import { loadPeople, makeDb } from "./fixtures.mjs";

const setup = async () => {
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "ceo" };
  const v = () => getVersion(w.db);
  const fn = async (input) => createFunction(w.db, { actor, expectedVersion: await v(), ...input });
  const up = async (input) => updateFunction(w.db, { actor, expectedVersion: await v(), ...input });
  return { ...w, actor, v, fn, up };
};
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || (assert.fail(`expected ${code}, got ${error.code}: ${error.message}`), false));

test("functions and specialisations: creation, two-level depth, unique names", async () => {
  const w = await setup();
  const tech = await w.fn({ name: "Technology & Engineering", legacyKeys: ["Engineering"] });
  const ai = await w.fn({ name: "AI Research & Development", parentId: tech.id });
  const row = (await w.db.query("SELECT kind, parent_id FROM public.org_departments WHERE id = $1", [ai.id])).rows[0];
  assert.deepEqual([row.kind, row.parent_id], ["specialisation", tech.id]);
  await rejects(w.fn({ name: "Too deep", parentId: ai.id }), "depth");
  await rejects(w.fn({ name: "technology & engineering" }), "exists");
  await rejects(w.fn({ name: "Other", legacyKeys: ["Engineering"] }), "legacy_key");
  await rejects(w.fn({ name: "X" }), "invalid");   // too short: plain validation error
});

test("renaming keeps the stable id, the legacy names and every assignment", async () => {
  const w = await setup();
  const eng = await w.fn({ name: "Engineering", legacyKeys: ["Engineering"] });
  await applyChange(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), input: { subjectRef: "account-4", title: "Senior Dev", departmentId: eng.id } });
  await w.up({ id: eng.id, name: "Technology & Engineering" });
  const chart = await getChart(w.db, loadPeople);
  assert.equal(chart.nodes["account-4"].department, "Technology & Engineering");
  assert.equal(chart.nodes["account-4"].title, "Senior Dev");              // a function name never replaces a job title
  const unit = (await w.db.query("SELECT id, legacy_keys FROM public.org_departments WHERE id = $1", [eng.id])).rows[0];
  assert.deepEqual(unit.legacy_keys, ["Engineering"]);
});

test("reorganising: move a function under another, protect depth, archive only when empty", async () => {
  const w = await setup();
  const tech = await w.fn({ name: "Tech" });
  const data = await w.fn({ name: "Data" });
  const spec = await w.fn({ name: "Data Engineering", parentId: data.id });
  await w.up({ id: spec.id, parentId: tech.id });                                  // transfer between functions
  assert.equal((await w.db.query("SELECT parent_id FROM public.org_departments WHERE id = $1", [spec.id])).rows[0].parent_id, tech.id);
  await rejects(w.up({ id: tech.id, parentId: data.id }), "depth");                // has a specialisation: cannot become one
  await rejects(w.up({ id: tech.id, parentId: tech.id }), "cycle");
  await applyChange(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), input: { subjectRef: "account-3", title: "Lead", departmentId: spec.id, leadOfAdd: [spec.id] } });
  await rejects(w.up({ id: spec.id, active: false }), "in_use");                   // someone still sits there
  await rejects(w.up({ id: tech.id, active: false }), "in_use");                   // has an active specialisation
  await applyChange(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), input: { subjectRef: "account-3", title: "Lead", departmentId: null } });
  await w.up({ id: spec.id, active: false });
  const lead = await w.db.query("SELECT count(*)::int n FROM public.org_department_leads WHERE department_id = $1 AND effective_to IS NULL", [spec.id]);
  assert.equal(lead.rows[0].n, 0);                                                 // archiving closes the lead, history is kept
  const history = await w.db.query("SELECT count(*)::int n FROM public.org_department_leads WHERE department_id = $1", [spec.id]);
  assert.equal(history.rows[0].n, 1);
});

test("every structural change is versioned and audited; stale writes are refused", async () => {
  const w = await setup();
  const before = await w.v();
  const a = await w.fn({ name: "Growth & Partnerships" });
  assert.equal(await w.v(), before + 1);
  await assert.rejects(createFunction(w.db, { actor: w.actor, expectedVersion: before, name: "Late" }), (e) => e.code === "stale");
  await assert.rejects(createFunction(w.db, { actor: w.actor, name: "No version" }), (e) => e.code === "version_required");
  await w.up({ id: a.id, name: "Growth" });
  const log = (await w.db.query("SELECT kind, before, after FROM public.org_changes ORDER BY version_after")).rows;
  assert.deepEqual(log.map((r) => r.kind), ["function.created", "function.updated"]);
  assert.equal(log[1].before.name, "Growth & Partnerships");
  assert.equal(log[1].after.name, "Growth");
  await rejects(w.up({ id: a.id, name: "Growth" }), "no_change");
});

test("initiatives run across functions with exactly one accountable owner, with history", async () => {
  const w = await setup();
  const make = async (input) => createInitiative(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), ...input });
  await rejects(make({ name: "Orgni" }), "owner_required");
  await rejects(make({ name: "Orgni", ownerRef: "intern-1" }), "ineligible");     // interns cannot be accountable owners
  await rejects(make({ name: "Orgni", ownerRef: "account-5" }), "inactive");
  const orgni = await make({ name: "Orgni", ownerRef: "account-2" });
  await rejects(make({ name: "orgni", ownerRef: "account-3" }), "exists");
  await updateInitiative(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), id: orgni.id, ownerRef: "account-3" });
  const owners = (await w.db.query("SELECT owner_ref, effective_to FROM public.org_initiative_owners WHERE initiative_id = $1 ORDER BY effective_from, id", [orgni.id])).rows;
  assert.equal(owners.length, 2);                                                   // the previous owner stays in history
  assert.equal(owners.filter((o) => o.effective_to === null).length, 1);
  const [current] = await listInitiatives(w.db);
  assert.equal(current.ownerRef, "account-3");
  await assert.rejects(w.db.query("DELETE FROM public.org_initiative_owners"), /cannot be deleted/);
  await rejects(updateInitiative(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), id: orgni.id, ownerRef: null }), "owner_required");
});

test("titles, functions and ownership never grant system permissions", async () => {
  const w = await setup();
  const owner = await w.user("owner", "Member");
  const tech = await w.fn({ name: "Technology & Engineering" });
  await applyChange(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), input: { subjectRef: "account-2", title: "VP of Engineering", departmentId: tech.id, leadOfAdd: [tech.id] } });
  await createInitiative(w.db, loadPeople, { actor: w.actor, expectedVersion: await w.v(), name: "Aiviate", ownerRef: "account-2" });
  const caps = await w.db.query("SELECT count(*)::int n FROM public.org_capabilities");
  assert.equal(caps.rows[0].n, 0);
  assert.equal((await w.db.query("SELECT role FROM public.ops_users WHERE id = $1", [owner])).rows[0].role, "Member");
});
