import assert from "node:assert/strict";
import test from "node:test";
import { handOffObjectives, majorObjectives, objectiveTeamLeadId } from "./objective-handoff.mjs";

const objectives = [
  { id: "1", title: "Teams integration", managerId: "account-2", status: "In progress", priority: "High" },
  { id: "2", title: "Data quality checks", managerId: "account-3", status: "Not started", priority: "Medium" },
  { id: "3", title: "Already with Alisha", managerId: "account-1", status: "Not started", priority: "Low" },
  { id: "4", title: "Sales opportunities", managerId: "account-17", status: "Complete", priority: "High" },
];

test("handing off moves the owner, remembers the previous team lead, and touches nothing else", () => {
  const { objectives: next, changed } = handOffObjectives(objectives, "account-1");
  assert.deepEqual(next.map((o) => o.managerId), ["account-1", "account-1", "account-1", "account-1"]);
  assert.deepEqual(next.map((o) => o.teamLeadId), ["account-2", "account-3", undefined, "account-17"]);
  assert.deepEqual(changed.map((c) => c.id), ["1", "2", "4"]);                       // the one already with her is untouched
  for (const [index, objective] of next.entries()) {
    const { managerId, teamLeadId, ...rest } = objective;
    const { managerId: _m, ...original } = objectives[index];
    assert.deepEqual(rest, original);                                                  // titles, status, priority, dates unchanged
    void managerId; void teamLeadId;
  }
  assert.equal(objectives[0].managerId, "account-2");                                  // the input is not mutated
});

test("handing off twice changes nothing and never overwrites the original team lead", () => {
  const once = handOffObjectives(objectives, "account-1").objectives;
  const twice = handOffObjectives(once, "account-1");
  assert.deepEqual(twice.changed, []);
  assert.deepEqual(twice.objectives, once);
  const moved = handOffObjectives(once, "account-9").objectives;                       // later handed to someone else
  assert.equal(moved[0].teamLeadId, "account-2");                                      // still the original team
});

test("the CEO sees only objectives owned by direct links; with no links everything is visible", () => {
  const passed = handOffObjectives(objectives, "account-1").objectives;
  const extra = [...passed, { id: "5", title: "Brand plan", managerId: "intern-33", status: "Not started" }, { id: "6", title: "Research notes", managerId: "intern-13", status: "Not started" }, { id: "7", title: "Team-level task", managerId: "account-2", status: "Not started" }];
  const major = majorObjectives(extra, ["account-1", "intern-13", "intern-33"]);
  assert.deepEqual(major.map((o) => o.id), ["1", "2", "3", "4", "5", "6"]);            // Alisha's, Thokozani's and Abdullah's
  assert.equal(major.some((o) => o.id === "7"), false);                                // a team lead's own objective is not major
  assert.equal(majorObjectives(extra, []).length, extra.length);
});

test("the team is shown only when it differs from the owner", () => {
  assert.equal(objectiveTeamLeadId({ managerId: "account-1", teamLeadId: "account-2" }), "account-2");
  assert.equal(objectiveTeamLeadId({ managerId: "account-1", teamLeadId: "account-1" }), null);
  assert.equal(objectiveTeamLeadId({ managerId: "account-1" }), null);
});
