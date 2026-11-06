import assert from "node:assert/strict";
import test from "node:test";
import { planSeed } from "./seed.mjs";

const accounts = [
  { id: 1, display_name: "Ada", email: "ada@x.test", department: "Engineering", reports_to_account_id: 9 },
  { id: 2, display_name: "Bo", email: "bo@x.test", department: "Data & Security", reports_to_account_id: 9 },
  { id: 9, display_name: "Root Admin", email: "root@x.test", department: "Unassigned", reports_to_account_id: null },
];
const interns = [
  { id: 1, full_name: "Ada", email: "ada@x.test", position: "AI Engineering", department: "Engineering", employment_status: "Active", completion_date: "2020-01-01", supervisor_account_id: null, supervisor_email: null, supervisor_name: null },
  { id: 2, full_name: "Cy", email: "cy@x.test", position: "Data Intern", department: "Engineering", employment_status: "Active", supervisor_account_id: 2, supervisor_email: null, supervisor_name: null },
  { id: 3, full_name: "Di", email: "di@x.test", position: "Data Intern", department: "Engineering", employment_status: "Active", supervisor_account_id: null, supervisor_email: "BO@x.test", supervisor_name: null },
  { id: 4, full_name: "Ed", email: "ed@x.test", position: "Intern", department: "", employment_status: "Active", supervisor_account_id: null, supervisor_email: null, supervisor_name: null },
  { id: 5, full_name: "Fy", email: "fy@x.test", position: "Intern", department: "", employment_status: "Completed", supervisor_account_id: null, supervisor_email: null, supervisor_name: null },
];
const opsUsers = [{ email: "root@x.test", role: "Superadmin" }, { email: "ada@x.test", role: "Manager" }];

test("only explicit source facts are seeded; guesses are held for confirmation", () => {
  const plan = planSeed({ accounts, interns, opsUsers });
  const supervisors = plan.relationships.filter((r) => r.type === "intern_supervisor");
  assert.deepEqual(supervisors.map((r) => r.subjectRef), ["intern-2"]);
  assert.deepEqual(plan.review.nameOnlySupervisors, [{ internRef: "intern-3", proposed: "account-2", via: "supervisor_email" }]);
  assert.deepEqual(plan.review.departmentFallback, ["intern-1", "intern-4"]);
  assert.deepEqual(plan.review.identityCandidates, [{ supersededRef: "intern-1", canonicalRef: "account-1", via: "email" }]);
  assert.deepEqual(plan.review.completedInterns, ["intern-5"]);
  assert.deepEqual(plan.review.inconsistentStatus, ["intern-1"]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.exclusions.length, 0);
});

test("a bare name match is proposed as name-only evidence, never applied", () => {
  const plan = planSeed({ accounts, interns: [{ ...interns[0], email: "" }], opsUsers });
  assert.deepEqual(plan.review.identityCandidates, [{ supersededRef: "intern-1", canonicalRef: "account-1", via: "name only" }]);
  assert.equal(plan.links.length, 0);
});

test("a technical Superadmin manager is flagged, not silently excluded or re-parented", () => {
  const plan = planSeed({ accounts, interns, opsUsers });
  assert.deepEqual(plan.review.technicalManagers, [{ managerRef: "account-9", reports: ["account-1", "account-2"] }]);
  assert.equal(plan.relationships.filter((r) => r.type === "reports_to").length, 2);
});

test("confirmations are applied only for exactly what is named", () => {
  const plan = planSeed({ accounts, interns, opsUsers }, {
    links: { "intern-1": "account-1" },
    exclusions: { "account-9": "Technical administration account" },
    supervisors: { "intern-3": "account-2" },
  });
  assert.equal(plan.links.length, 1);
  assert.equal(plan.exclusions.length, 1);
  assert.equal(plan.relationships.filter((r) => r.type === "intern_supervisor").length, 2);
  assert.equal(plan.pendingConfirmation.identityLinks.length, 0);
  assert.equal(plan.pendingConfirmation.technicalAccounts.length, 0);
  const wrong = planSeed({ accounts, interns, opsUsers }, { supervisors: { "intern-3": "account-1" } });
  assert.equal(wrong.relationships.filter((r) => r.type === "intern_supervisor").length, 1);
});

test("employees get a visible not-set title instead of an invented one; departments are the official four", () => {
  const plan = planSeed({ accounts, interns, opsUsers });
  assert.equal(plan.assignments.find((a) => a.personRef === "account-1").title, "Title not set");
  assert.equal(plan.assignments.find((a) => a.personRef === "account-9").department, null);
  assert.equal(plan.departments.length, 4);
});
