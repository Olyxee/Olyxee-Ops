import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { applyChange, getChart, getVersion } from "./store.mjs";
import { createFunction } from "./structure.mjs";
import { buildFunctionsView, functionLookup } from "./functions-view.mjs";
import { departmentInList, loadFunctionKeys } from "./function-keys.mjs";
import { registerOrgRoutes } from "./routes.mjs";
import { loadPeople, makeDb } from "./fixtures.mjs";

async function world() {
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "ceo" };
  const v = () => getVersion(w.db);
  const fn = async (input) => createFunction(w.db, { actor, expectedVersion: await v(), ...input });
  const change = async (input) => applyChange(w.db, loadPeople, { actor, expectedVersion: await v(), input });
  return { ...w, userId, actor, v, fn, change };
}

test("the functions view is built from stored records: leaders, members, specialisations, ordering", async () => {
  const w = await world();
  const growth = await w.fn({ name: "Growth", legacyKeys: ["Sales & Marketing"] });
  const tech = await w.fn({ name: "Technology", legacyKeys: ["Engineering"] });
  const data = await w.fn({ name: "Data Engineering", parentId: tech.id, legacyKeys: ["Data & Security"] });
  await w.change({ subjectRef: "account-1", title: "Founder", leadOfAdd: [growth.id] });            // the CEO owns Growth but is not a member of it
  await w.change({ subjectRef: "account-2", title: "VP", departmentId: tech.id, leadOfAdd: [tech.id] });
  await w.change({ subjectRef: "account-3", title: "Lead", departmentId: data.id, leadOfAdd: [data.id] });
  await w.change({ subjectRef: "intern-1", title: "Intern", departmentId: data.id, internSupervisor: "account-3" });
  const view = buildFunctionsView(await getChart(w.db, loadPeople));
  assert.deepEqual(view.functions.map((f) => f.name), ["Growth", "Technology"]);                        // creation order, not alphabetical
  const [g, t] = view.functions;
  assert.equal(g.leader.name, "Ada Chief");
  assert.deepEqual(g.memberRefs, []);                                                                   // the owner is not counted as a member
  assert.equal(t.leader.title, "VP");
  assert.deepEqual([...t.memberRefs].sort(), ["account-2", "account-3", "intern-1"]);                   // rolled up from the specialisation
  assert.equal(t.specialisations[0].name, "Data Engineering");
  assert.equal(t.specialisations[0].leader.name, "Cy Lead");
  assert.deepEqual([...t.specialisations[0].memberRefs].sort(), ["account-3", "intern-1"]);
  // leadership is data: replacing the leader changes the view immediately
  await w.change({ subjectRef: "account-4", title: "New VP", departmentId: tech.id, leadOfAdd: [tech.id] });
  assert.equal(buildFunctionsView(await getChart(w.db, loadPeople)).functions[1].leader.name, "Di Dev");
  // every name a unit has used resolves to its top-level function
  const lookup = functionLookup(view);
  assert.equal(lookup.get("engineering"), "Technology");
  assert.equal(lookup.get("data & security"), "Technology");                                            // legacy name of a specialisation rolls up
  assert.equal(lookup.get("sales & marketing"), "Growth");
  assert.equal(lookup.get("data engineering"), "Technology");
});

test("renamed or new functions keep resolving stored department names", async () => {
  const w = await world();
  const eng = await w.fn({ name: "Engineering", legacyKeys: ["Engineering"] });
  const ops = await w.fn({ name: "Operations" });
  const { keys } = await loadFunctionKeys(w.db);
  assert.equal(keys.get("engineering"), "Engineering");
  assert.equal(keys.get("operations"), "Operations");                                                  // a new function stores its own name
  const { updateFunction } = await import("./structure.mjs");
  await updateFunction(w.db, { actor: w.actor, expectedVersion: await w.v(), id: eng.id, name: "Technology & Engineering" });
  const { keys: after, groups } = await loadFunctionKeys(w.db);
  assert.equal(after.get("technology & engineering"), "Engineering");                                  // new name stores the key old records use
  assert.equal(after.get("engineering"), "Engineering");                                               // the old name still resolves
  assert.equal(groups.get("engineering"), "technology & engineering");                                  // legacy name groups under the renamed function
  void ops;
});

test("GET /api/org/functions is readable by any signed-in person and exposes no contact details", async () => {
  const w = await world();
  const tech = await w.fn({ name: "Technology" });
  await w.change({ subjectRef: "account-2", title: "VP", departmentId: tech.id, leadOfAdd: [tech.id] });
  const app = express();
  app.use(express.json());
  const requireAuth = (request, response, next) => (request.headers["x-user"] ? next() : response.status(401).json({ error: "auth" }));
  const requireAccount = (request, _response, next) => { request.appAccount = { id: w.userId, email: "x@example.test", display_name: "x", app_role: "Member" }; next(); };
  registerOrgRoutes(app, { db: w.db, loadPeople, requireAuth, requireAccount, isEnabled: () => true, notify: async () => {} });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/org/functions`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { "x-user": "member" } });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(JSON.parse(text).functions[0].leader.name, "Bo Vice");
    assert.equal(/@example\.test/.test(text), false);
  } finally { server.close(); }
});

test("a manager of a specialisation is treated as being in the whole function for permissions, but not in other functions", async () => {
  const w = await world();
  const tech = await w.fn({ name: "Technology", legacyKeys: ["Engineering"] });
  await w.fn({ name: "Data Engineering", parentId: tech.id, legacyKeys: ["Data & Security"] });
  await w.fn({ name: "Growth", legacyKeys: ["Sales & Marketing"] });
  const { groups } = await loadFunctionKeys(w.db);
  assert.equal(departmentInList(groups, ["Engineering"], "Data & Security"), true);             // specialisation manager, function-wide task
  assert.equal(departmentInList(groups, ["Technology"], "Engineering"), true);                   // new name vs stored legacy name
  assert.equal(departmentInList(groups, ["Sales & Marketing"], "Data & Security"), false);       // another function stays out of scope
  assert.equal(departmentInList(groups, ["Engineering", "Sales & Marketing"], "Growth"), true);  // cross-functional task
  assert.equal(departmentInList(groups, ["Engineering"], ""), false);
  assert.equal(departmentInList(new Map(), ["Engineering"], "Engineering"), true);               // unknown names fall back to exact match
});

test("a function may reuse an old department's name: stored text keeps its old meaning, live names win", async () => {
  const w = await world();
  const product = await w.fn({ name: "Product Engineering", legacyKeys: ["Engineering"] });
  await w.fn({ name: "AI Research & Development", parentId: product.id, legacyKeys: ["Research & Development (R&D)"] });   // old R&D department
  await w.fn({ name: "Research & Development (R&D)", legacyKeys: ["Data & Security"] });                                    // a function that now has that same name
  const { keys, groups, nameGroups } = await loadFunctionKeys(w.db);
  const rd = "research & development (r&d)";
  assert.equal(keys.get(rd), "Data & Security");                                    // picking the R&D function stores the key its own records use
  assert.equal(groups.get(rd), "product engineering");                              // old tasks stored as "Research & Development (R&D)" stay with the team that did them
  assert.equal(nameGroups.get(rd), rd);                                             // a person assigned to the R&D function is in that function
  assert.equal(nameGroups.get("ai research & development"), "product engineering");
  assert.equal(departmentInList(groups, ["Research & Development (R&D)"], "AI Research & Development", nameGroups), true);   // the AI team sees its old R&D-stored work
  assert.equal(departmentInList(groups, ["Data & Security"], "Research & Development (R&D)", nameGroups), true);              // the R&D function sees work stored under its own old key
  assert.equal(departmentInList(groups, ["Engineering"], "Research & Development (R&D)", nameGroups), false);                 // and not the other function's work
});
