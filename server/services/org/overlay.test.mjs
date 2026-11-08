import assert from "node:assert/strict";
import test from "node:test";

import { visiblePeopleForManager } from "./overlay.mjs";

test("a function leader sees their function's people, including its teams and direct reports, but not other functions", () => {
  const nameGroups = new Map([["product engineering", "product engineering"], ["data engineering", "product engineering"], ["software engineering", "product engineering"], ["research & development (r&d)", "research & development (r&d)"], ["ai research & development", "research & development (r&d)"], ["growth & partnerships", "growth & partnerships"]]);
  const people = [
    { id: "account-1", department: "Product Engineering" },                           // Alisha
    { id: "account-3", department: "Data Engineering", reportsTo: "account-1" },     // Mosa
    { id: "intern-34", department: "Data Engineering", reportsTo: "account-3" },     // Taketji (a team member)
    { id: "intern-31", department: "Software Engineering", reportsTo: "account-1" }, // Muhammad
    { id: "account-2", department: "AI Research & Development", reportsTo: "intern-13" },   // Emmanuel now in R&D
    { id: "intern-33", department: "Growth & Partnerships" },
  ];
  const ids = (list) => list.map((person) => person.id).sort();
  assert.deepEqual(ids(visiblePeopleForManager(people, people[0], nameGroups)), ["account-1", "account-3", "intern-31", "intern-34"]);
  assert.deepEqual(ids(visiblePeopleForManager(people, people[4], nameGroups)), ["account-2"]);       // sees themselves in their own function
  assert.deepEqual(visiblePeopleForManager(people, undefined, nameGroups), []);                        // an unknown person sees no one
  // someone who reports to the manager is visible even from another function
  const cross = [...people, { id: "intern-9", department: "Growth & Partnerships", reportsTo: "account-1" }];
  assert.ok(ids(visiblePeopleForManager(cross, people[0], nameGroups)).includes("intern-9"));
});

test("only someone who leads a whole function sees the full directory; a team lead or anyone else does not", async () => {
  const { makeDb } = await import("./fixtures.mjs");
  const { createFunction } = await import("./structure.mjs");
  const { applyChange, getVersion } = await import("./store.mjs");
  const { loadPeople } = await import("./fixtures.mjs");
  const { leadsTopLevelFunction } = await import("./overlay.mjs");
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "ceo" };
  const fn = await createFunction(w.db, { actor, expectedVersion: await getVersion(w.db), name: "Product Engineering" });
  const team = await createFunction(w.db, { actor, expectedVersion: await getVersion(w.db), name: "Data Engineering", parentId: fn.id });
  await applyChange(w.db, loadPeople, { actor, expectedVersion: await getVersion(w.db), input: { subjectRef: "account-2", title: "VP", departmentId: fn.id, leadOfAdd: [fn.id] } });
  await applyChange(w.db, loadPeople, { actor, expectedVersion: await getVersion(w.db), input: { subjectRef: "account-3", title: "Lead", departmentId: team.id, leadOfAdd: [team.id] } });
  assert.equal(await leadsTopLevelFunction(w.db, "account-2"), true);       // the function's leader
  assert.equal(await leadsTopLevelFunction(w.db, "account-3"), false);      // leads only a team inside it
  assert.equal(await leadsTopLevelFunction(w.db, "account-4"), false);      // leads nothing
  assert.equal(await leadsTopLevelFunction(w.db, null), false);
});
