import assert from "node:assert/strict";
import test from "node:test";
import { objectiveGroupsFor } from "./objective-groups.mjs";

const objectives = [
  { id: "a", managerId: "eng", title: "A", dueDate: "2026-10-03", status: "Complete" },
  { id: "b", managerId: "sales", title: "B", dueDate: "2026-10-02", status: "In progress" },
  { id: "c", managerId: "eng", title: "C", dueDate: "2026-10-01", status: "In progress" },
  { id: "d", managerId: "missing", title: "D", dueDate: "2026-10-04", status: "Not started" },
];
const departmentFor = objective => ({ eng: "Engineering", sales: "Sales & Marketing" })[objective.managerId];

test("All groups visible objectives by department with active work before completed work", () => {
  const groups = objectiveGroupsFor(objectives, departmentFor);
  assert.deepEqual(groups.map(group => group.department), ["Engineering", "Sales & Marketing", "Unassigned"]);
  assert.deepEqual(groups[0].objectives.map(objective => objective.id), ["c", "a"]);
  assert.equal(groups.reduce((total, group) => total + group.objectives.length, 0), objectives.length);
});

test("grouping cannot reintroduce objectives excluded by role visibility", () => {
  const managerVisible = objectives.filter(objective => objective.managerId === "eng" && objective.status !== "Complete");
  const groups = objectiveGroupsFor(managerVisible, departmentFor);
  assert.deepEqual(groups.map(group => [group.department, group.objectives.map(objective => objective.id)]), [["Engineering", ["c"]]]);
  assert.deepEqual(objectives.map(objective => objective.id), ["a", "b", "c", "d"]);
});

test("older department names stay visible and unassigned objectives appear last", () => {
  const groups = objectiveGroupsFor(objectives, objective => objective.managerId === "sales" ? "Former department" : departmentFor(objective));
  assert.deepEqual(groups.map(group => group.department), ["Engineering", "Former department", "Unassigned"]);
});