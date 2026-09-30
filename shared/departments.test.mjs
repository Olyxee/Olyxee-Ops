import assert from "node:assert/strict";
import test from "node:test";
import { resolveDepartment } from "./departments.mjs";

test("a saved department assignment wins over inferred job-title keywords", () => {
  assert.equal(resolveDepartment({
    department: "Sales & Marketing",
    position: "AI engineer",
  }).department, "Sales & Marketing");
});

test("unassigned people can still be classified by their role", () => {
  assert.equal(resolveDepartment({
    department: "Unassigned",
    position: "AI engineer",
  }).department, "Engineering");
});