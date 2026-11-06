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

test("an active intern-record person can supervise other interns, but never in a loop", () => {
  const people = new Map(PEOPLE.map((p) => [p.ref, p]));
  people.set("intern-3", { ref: "intern-3", name: "Kay Senior", employmentType: "Intern", active: true, status: "Active" });
  const base = snapshot({ people, supervisors: new Map([["intern-3", "account-3"]]) });
  const plan = planChange(base, normalizeChange({ subjectRef: "intern-1", internSupervisor: "intern-3" }));
  assert.deepEqual(plan.ops.openRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "intern-3" }]);
  assert.equal(plan.after.reportsTo, undefined);                                  // supervision is not line management
  rejects(() => planChange(base, normalizeChange({ subjectRef: "intern-1", internSupervisor: "intern-1" })), "cycle");
  const looped = snapshot({ people, supervisors: new Map([["intern-1", "intern-3"], ["intern-3", "account-3"]]) });
  rejects(() => planChange(looped, normalizeChange({ subjectRef: "intern-3", internSupervisor: "intern-1" })), "cycle");
  rejects(() => planChange(base, normalizeChange({ subjectRef: "intern-1", internSupervisor: "intern-2" })), "inactive");
});

test("a senior person recorded as an intern can report to a manager instead of being supervised, never both", () => {
  // intern-1 is currently supervised: a reporting line alone is refused, but swapping in one change is allowed
  rejects(() => planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", reportsTo: "account-2" })), "ineligible");
  const swap = planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", reportsTo: "account-2", internSupervisor: null }));
  assert.deepEqual(swap.ops.openRelationships, [{ type: "reports_to", subjectRef: "intern-1", managerRef: "account-2" }]);
  assert.deepEqual(swap.ops.closeRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "account-3" }]);
  // and once they report to someone, adding a supervisor is refused
  const lined = snapshot({ supervisors: new Map(), reportsTo: new Map([["intern-1", "account-2"], ["account-2", "account-1"]]) });
  rejects(() => planChange(lined, normalizeChange({ subjectRef: "intern-1", internSupervisor: "account-3" })), "ineligible");
});

test("employment type is Ops-owned: converting an intern to an employee swaps supervision for a reporting line", () => {
  const plan = planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", employmentType: "Employee", reportsTo: "account-2" }));
  assert.deepEqual(plan.ops.classification, { employmentType: "Employee" });
  assert.deepEqual(plan.ops.closeRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "account-3" }]);
  assert.deepEqual(plan.ops.openRelationships, [{ type: "reports_to", subjectRef: "intern-1", managerRef: "account-2" }]);
  assert.match(plan.summary[0], /Employment: Intern → Employee/);
  // the old supervisor is closed automatically even when only the type is changed
  const typeOnly = planChange(snapshot(), normalizeChange({ subjectRef: "intern-1", employmentType: "Employee" }));
  assert.deepEqual(typeOnly.ops.closeRelationships, [{ type: "intern_supervisor", subjectRef: "intern-1", managerRef: "account-3" }]);
  // leadership does not depend on employment type: a person still recorded as an intern can lead a function
  const withDept = snapshot({ departments: new Map([["d-eng", { id: "d-eng", name: "Engineering", active: true }]]) });
  assert.equal(planChange(withDept, normalizeChange({ subjectRef: "intern-1", leadOfAdd: ["d-eng"] })).ops.openLeads.length, 1);
  rejects(() => planChange(withDept, normalizeChange({ subjectRef: "intern-2", leadOfAdd: ["d-eng"] })), "inactive");   // but they must be active
  rejects(() => normalizeChange({ subjectRef: "intern-1", employmentType: "Contractor" }));
});

test("a person who leads a function can be recorded as either type; the leadership stays", () => {
  const leading = snapshot({ departments: new Map([["d-eng", { id: "d-eng", name: "Engineering", active: true }]]), departmentLeads: new Map([["d-eng", "account-4"]]) });
  const ok = planChange(leading, normalizeChange({ subjectRef: "account-4", employmentType: "Intern", internSupervisor: "account-3" }));
  assert.deepEqual(ok.ops.classification, { employmentType: "Intern" });
  assert.equal(ok.ops.closeLeads.length, 0);
  assert.deepEqual(ok.ops.closeRelationships, [{ type: "reports_to", subjectRef: "account-4", managerRef: "account-3" }]);
});
