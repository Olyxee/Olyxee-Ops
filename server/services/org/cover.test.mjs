import assert from "node:assert/strict";
import test from "node:test";
import { OrgError } from "./plan.mjs";
import { applyChange, getChart, getVersion, grantCapability } from "./store.mjs";
import { startCover, endCover } from "./cover.mjs";
import { PEOPLE, makeDb, person } from "./fixtures.mjs";

const loadPeople = async () => [...PEOPLE.filter((item) => item.ref !== "account-5"), person("account-5", "Ed Interim")];

async function world() {
  const w = await makeDb();
  const eng = await w.dept("Engineering");
  const ceo = await w.user("ceo", "Manager");
  await grantCapability(w.db, { userId: ceo, capability: "org.approve", via: "bootstrap" });
  const actor = { userId: ceo, name: "CEO" };
  const apply = async (input) => applyChange(w.db, loadPeople, { actor, input, expectedVersion: await getVersion(w.db) });
  // account-1 = CEO, account-2 leads Engineering, account-3 and account-4 report to account-2, account-5 is the stand-in
  await apply({ subjectRef: "account-1", title: "CEO" });
  await apply({ subjectRef: "account-2", title: "Head", departmentId: eng, reportsTo: "account-1", leadOfAdd: [eng] });
  await apply({ subjectRef: "account-3", title: "Lead A", departmentId: eng, reportsTo: "account-2" });
  await apply({ subjectRef: "account-4", title: "Lead B", departmentId: eng, reportsTo: "account-2" });
  await apply({ subjectRef: "account-5", title: "Interim", departmentId: eng, reportsTo: "account-1" });
  return { ...w, eng, actor };
}

test("cover hands leadership and reports to the stand-in, marks both people, and can be handed back", async () => {
  const w = await world();
  await startCover(w.db, loadPeople, { actor: w.actor, coveringRef: "account-5", coveredRef: "account-2", note: "away" });
  let chart = await getChart(w.db, loadPeople);
  assert.deepEqual(chart.nodes["account-5"].leadsDepartments, [w.eng]);
  assert.deepEqual(chart.nodes["account-2"].leadsDepartments, []);
  assert.equal(chart.nodes["account-3"].reportsTo, "account-5");
  assert.equal(chart.nodes["account-4"].reportsTo, "account-5");
  assert.equal(chart.nodes["account-5"].reportsTo, "account-1");
  assert.equal(chart.nodes["account-5"].covering.ref, "account-2");
  assert.equal(chart.nodes["account-2"].coveredBy.ref, "account-5");
  assert.equal(chart.nodes["account-2"].reportsTo, "account-1");   // stays on the chart under the CEO
  assert.deepEqual(chart.issues.filter((i) => ["account-1","account-2","account-3","account-4","account-5"].includes(i.ref)).map((i) => i.code), []);

  await endCover(w.db, loadPeople, { actor: w.actor, coveredRef: "account-2" });
  chart = await getChart(w.db, loadPeople);
  assert.deepEqual(chart.nodes["account-2"].leadsDepartments, [w.eng]);
  assert.equal(chart.nodes["account-3"].reportsTo, "account-2");
  assert.equal(chart.nodes["account-4"].reportsTo, "account-2");
  assert.equal(chart.nodes["account-5"].covering, undefined);
  assert.equal(chart.nodes["account-2"].coveredBy, undefined);
});

test("cover cannot be stacked and ending it twice is refused", async () => {
  const w = await world();
  await startCover(w.db, loadPeople, { actor: w.actor, coveringRef: "account-5", coveredRef: "account-2" });
  await assert.rejects(startCover(w.db, loadPeople, { actor: w.actor, coveringRef: "account-5", coveredRef: "account-3" }), (e) => e instanceof OrgError && e.code === "cover_active");
  await endCover(w.db, loadPeople, { actor: w.actor, coveredRef: "account-2" });
  await assert.rejects(endCover(w.db, loadPeople, { actor: w.actor, coveredRef: "account-2" }), (e) => e instanceof OrgError && e.code === "not_found");
});

test("someone moved on during the cover is not dragged back", async () => {
  const w = await world();
  await startCover(w.db, loadPeople, { actor: w.actor, coveringRef: "account-5", coveredRef: "account-2" });
  await applyChange(w.db, loadPeople, { actor: w.actor, input: { subjectRef: "account-4", reportsTo: "account-1" }, expectedVersion: await getVersion(w.db) });
  await endCover(w.db, loadPeople, { actor: w.actor, coveredRef: "account-2" });
  const chart = await getChart(w.db, loadPeople);
  assert.equal(chart.nodes["account-3"].reportsTo, "account-2");
  assert.equal(chart.nodes["account-4"].reportsTo, "account-1");
});
