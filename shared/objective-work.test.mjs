import assert from "node:assert/strict";
import test from "node:test";
import { objectiveWorkFor } from "./objective-work.mjs";

test("the same active tasks appear for Admin and Manager without deleting completed history", () => {
  const tasks = [
    { id: "complete", project: "Site", status: "Completed", due: "2026-09-28", activityLog: [{ action: "Completed" }] },
    { id: "open", project: "Site", status: "In Progress", due: "2026-10-02" },
    { id: "blocked", project: "Site", status: "Blocked", due: "2026-10-01" },
    { id: "unrelated", project: "Other", status: "Not Started", due: "2026-10-03" },
  ];
  for (const role of ["Admin", "Manager"]) {
    const result = objectiveWorkFor(tasks, ["Site"], "2026-09-30", true);
    assert.deepEqual(result.supportingWork.map(task => task.id), ["blocked", "open"], role);
    assert.equal(result.taskProgress, 33);
    assert.equal(result.completedCount, 1);
  }
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks[0].activityLog, [{ action: "Completed" }]);
});

test("without linked projects, active department work is shown and completed tasks are omitted", () => {
  const result = objectiveWorkFor([
    { id: "finished", status: "Completed", due: "2026-09-28" },
    { id: "pending", status: "Not Started", due: "2026-10-01" },
  ], [], "2026-09-30");
  assert.deepEqual(result.supportingWork.map(task => task.id), ["pending"]);
  assert.equal(result.completedCount, 1);
});

test("missing linked projects do not expose unrelated department tasks", () => {
  const result = objectiveWorkFor([{ project: "Other", status: "Not Started", due: "2026-10-01" }], [], "2026-09-30", true);
  assert.deepEqual(result.supportingWork, []);
});