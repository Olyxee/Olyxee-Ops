import assert from "node:assert/strict";
import test from "node:test";
import { companyDelivery, functionDelivery, mapDepartmentNames } from "./function-metrics.mjs";

const task = (status, ...departments) => ({ status, departmentIds: departments });
const functionOf = (name) => ({ engineering: "Technology", "research & development (r&d)": "Technology", "sales & marketing": "Growth" })[name.toLowerCase()] || name;

test("old department names roll up to one function without duplicates", () => {
  assert.deepEqual(mapDepartmentNames(["Engineering", "Research & Development (R&D)"], functionOf), ["Technology"]);
  assert.deepEqual(mapDepartmentNames(["Engineering", "Sales & Marketing"], functionOf), ["Technology", "Growth"]);
  assert.deepEqual(mapDepartmentNames(undefined, functionOf), []);
});

test("a function with no measurable work has no percentage, not 0%", () => {
  assert.equal(functionDelivery([]).completionPercent, null);
  assert.equal(functionDelivery([task("Cancelled", "x")]).completionPercent, null);   // cancelled work is not measurable
  assert.equal(functionDelivery([task("Not started", "x")]).completionPercent, 0);    // real work, none finished: a genuine 0%
  assert.equal(functionDelivery([task("Completed", "x"), task("Blocked", "x"), task("In progress", "x"), task("Cancelled", "x")]).completionPercent, 33);
});

test("counts: open, blocked and completed come from the tasks themselves", () => {
  const result = functionDelivery([task("Completed"), task("Blocked"), task("In progress"), task("Cancelled")]);
  assert.deepEqual(result, { total: 3, completed: 1, open: 2, blocked: 1, completionPercent: 33 });
});

test("a cross-functional task counts once per function and once company-wide", () => {
  const shared = task("Completed", "Engineering", "Sales & Marketing");
  const tech = [shared, task("In progress", "Engineering")];
  const growth = [shared];
  assert.equal(functionDelivery(tech).total + functionDelivery(growth).total, 3);   // each function sees the shared task
  assert.equal(companyDelivery([shared, tech[1]]).total, 2);                        // the company sees it once
});
