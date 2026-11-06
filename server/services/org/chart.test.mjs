import assert from "node:assert/strict";
import test from "node:test";
import { buildChart } from "./chart.mjs";

test("a linked duplicate record never overrides the person's own title and department", () => {
  const input = {
    people: [{ ref: "account-3", name: "Mosa", employmentType: "Employee", active: true, status: "Active" }],
    departments: [{ id: "ds", name: "Data & Security", active: true }, { id: "eng", name: "Engineering", active: true }],
    // the duplicate intern row is listed AFTER the real one, which used to win
    assignments: [{ personRef: "account-3", title: "Data Engineering Lead", departmentId: "ds" }, { personRef: "intern-5", title: "AI Engineering", departmentId: "eng" }],
    relationships: [], departmentLeads: [], exclusions: [],
    identityLinks: [{ supersededRef: "intern-5", canonicalRef: "account-3" }],
  };
  const node = buildChart(input).nodes["account-3"];
  assert.equal(node.title, "Data Engineering Lead");
  assert.equal(node.department, "Data & Security");
});
