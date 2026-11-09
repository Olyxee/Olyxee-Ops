import assert from "node:assert/strict";
import test from "node:test";
import { objectiveOwnersFor, assignableByLeader, leadsTeamOnProject, peopleLedBy, teamMemberRefs, teamsLedBy, validTeamIds } from "./project-teams.mjs";

const view = { functions: [
  { id: "f1", name: "Product Engineering", leader: { ref: "account-2" }, memberRefs: ["account-2", "account-3", "account-4", "intern-1"],
    specialisations: [{ id: "s1", leader: { ref: "account-3" }, memberRefs: ["account-3", "intern-1"] }] },
  { id: "f2", name: "R&D", leader: { ref: "account-5" }, memberRefs: ["account-5", "account-6"], specialisations: [] },
] };

test("a team brings its specialisations' people", () => {
  assert.deepEqual([...teamMemberRefs(view, ["f1"])].sort(), ["account-2", "account-3", "account-4", "intern-1"]);
  assert.equal(teamMemberRefs(view, ["nope"]).size, 0);
});

test("leaders of a function or of one of its specialisations lead that team", () => {
  assert.deepEqual(teamsLedBy(view, "account-2"), ["f1"]);
  assert.deepEqual(teamsLedBy(view, "account-3"), ["f1"]);
  assert.deepEqual(teamsLedBy(view, "account-9"), []);
});

test("a leader can assign only people from assigned teams they lead", () => {
  const project = { teamIds: ["f1"] };
  assert.deepEqual([...assignableByLeader(view, project, "account-2")].sort(), ["account-3", "account-4", "intern-1"]);
  assert.deepEqual([...assignableByLeader(view, project, "account-3")].sort(), ["intern-1"]);   // leads only the specialisation
  assert.equal(assignableByLeader(view, project, "account-5").size, 0);                 // leads a team that is not on the project
  assert.equal(assignableByLeader(view, { teamIds: [] }, "account-2").size, 0);        // no teams assigned yet
});

test("unknown or repeated teams are dropped", () => {
  assert.deepEqual(validTeamIds(view, ["f1", "f1", "zzz", 7]), ["f1"]);
  assert.deepEqual(validTeamIds(view, undefined), []);
});

test("a specialisation leader sees the project and the people they lead", () => {
  assert.equal(leadsTeamOnProject(view, { teamIds: ["f1"] }, "account-3"), true);
  assert.equal(leadsTeamOnProject(view, { teamIds: ["f2"] }, "account-3"), false);
  assert.deepEqual([...peopleLedBy(view, "account-3")].sort(), ["account-3", "intern-1"]);
});

test("a function leader can give objectives to the leaders of its teams; a team leader only to themselves", () => {
  assert.deepEqual([...objectiveOwnersFor(view, "account-2")].sort(), ["account-2", "account-3"]);
  assert.deepEqual([...objectiveOwnersFor(view, "account-3")], ["account-3"]);
});
