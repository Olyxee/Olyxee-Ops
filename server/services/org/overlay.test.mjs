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
