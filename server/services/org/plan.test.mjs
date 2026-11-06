import assert from "node:assert/strict";
import test from "node:test";
import { OrgError, normalizeChange, planChange, wouldCreateCycle } from "./plan.mjs";
import { PEOPLE } from "./fixtures.mjs";

const snapshot = (over = {}) => ({
  people: new Map(PEOPLE.map((p) => [p.ref, p])),
  departments: new Map([["d-eng", { id: "d-eng", name: "Engineering", active: true }], ["d-old", { id: "d-old", name: "Old", active: false }]]),
  assignments: new Map([["account-4", { title: "Developer", departmentId: "d-eng" }]]),
  reportsTo: new Map([["account-2", "account-1"], ["account-3", "account-2"], ["account-4", "account-3"]]),
  supervisors: new Map([["intern-1", "account-3"]]),
  functional: [], departmentLeads: new Map(), ...over,
});
const rejects = (fn, code) => assert.throws(fn, (e) => e instanceof OrgError && (!code || e.code === code));

test("normalizeChange rejects empty and malformed requests", () => {
  rejects(() => normalizeChange(null));
  rejects(() => normalizeChange({ subjectRef: "bad" }));
  rejects(() => normalizeChange({ subjectRef: "account-1" }));
  rejects(() => normalizeChange({ subjectRef: "account-1", title: "  " }));
  rejects(() => normalizeChange({ subjectRef: "account-1", reportsTo: "nope" }));
  assert.equal(normalizeChange({ subjectRef: "account-1", title: "  CEO   Role " }).title, "CEO Role");
});

test("wouldCreateCycle detects direct and indirect loops", () => {
  const map = new Map([["b", "a"], ["c", "b"]]);
  assert.equal(wouldCreateCycle(map, "a", "c"), true);   // a -> c while c -> b -> a
  assert.equal(wouldCreateCycle(map, "a", "a"), true);
  assert.equal(wouldCreateCycle(map, "c", "a"), false);
});

test("a promotion records before/after and leaves permissions out of scope", () => {
  const plan = planChange(snapshot(), normalizeChange({ subjectRef: "account-4", title: "Data Engineering Lead", departmentId: "d-eng" }));
  assert.deepEqual(plan.before, { title: "Developer", departmentId: "d-eng" });
  assert.equal(plan.after.title, "Data Engineering Lead");
  assert.ok(plan.summary.some((line) => line.includes("Developer → Data Engineering Lead")));
  assert.equal(Object.keys(plan.ops).includes("permissions"), false);
});

test("circular and self reporting are rejected", () => {
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-1", reportsTo: "account-4" })), "cycle");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-2", reportsTo: "account-2" })), "cycle");
});

test("managers must be active employees; interns are supervised, not line-managed", () => {
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", reportsTo: "account-5" })), "inactive");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", reportsTo: "intern-1" })), "ineligible");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", reportsTo: "account-2" })), "ineligible");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", internSupervisor: "account-2" })), "ineligible");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", internSupervisor: "account-5" })), "inactive");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", reportsTo: "account-99" })), "not_found");
});

test("reassigning intern supervision does not touch the line-management chain", () => {
  const plan = planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", internSupervisor: "account-4" }));
  assert.deepEqual(plan.ops.closeRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "account-3" }]);
  assert.deepEqual(plan.ops.openRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "account-4" }]);
  assert.equal(plan.after.reportsTo, undefined);
});

test("inactive departments and no-op changes are rejected", () => {
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", departmentId: "d-old" })), "department");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-4", title: "Developer" })), "no_change");
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "account-5", title: "X" })), "inactive");
});

test("replacing a department lead closes the incumbent and removing keeps the person", () => {
  const snap = snapshot({ departmentLeads: new Map([["d-eng", "account-3"]]) });
  const replace = planChange(snap, normalizeChange({ subjectRef: "account-4", leadOfAdd: ["d-eng"] }));
  assert.deepEqual(replace.ops.closeLeads, [{ departmentId: "d-eng", personRef: "account-3" }]);
  assert.deepEqual(replace.ops.openLeads, [{ departmentId: "d-eng", personRef: "account-4" }]);
  const remove = planChange(snap, normalizeChange({ subjectRef: "account-3", leadOfRemove: ["d-eng"] }));
  assert.deepEqual(remove.after.leadOf, []);
  assert.equal(remove.ops.assignment, null); // the employee and their title are untouched
});
