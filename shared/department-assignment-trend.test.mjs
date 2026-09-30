import assert from "node:assert/strict";
import test from "node:test";
import { departmentDailyTrend } from "./department-trend.mjs";
import { departmentHourlyTrend } from "./department-hourly-trend.mjs";
import { taskAssignmentTimes } from "./task-assignment-events.mjs";

const now = new Date("2026-09-30T12:30:00").getTime();
const createdAt = "2026-09-30T12:29:00";
const task = {
  createdDate: createdAt,
  status: "Not Started",
  due: "2026-10-05",
  assignee: "intern-1",
  assigneeIds: ["intern-1"],
  activityLog: [{ action: "Task created", createdAt, metadata: { assigneeIds: ["intern-1"] } }],
};
const curves = [
  ["manager home", tasks => departmentHourlyTrend(tasks, now)],
  ["intern home", tasks => departmentHourlyTrend(tasks, now, 24)],
  ["department detail", tasks => departmentDailyTrend(tasks, now)],
];

for (const [name, curve] of curves) {
  test(`${name}: a newly created and assigned task gives a small rise immediately`, () => {
    const points = curve([task]);
    assert.equal(points.at(-1).score, 2);
    assert.equal(points.at(-1).direction, "up");
    assert.equal(points.at(-1).hasProgress, true);
    assert.match(points.at(-1).event, /assignment/);
  });

  test(`${name}: multiple assignees on one task are not counted twice`, () => {
    const points = curve([{ ...task, assigneeIds: ["intern-1", "intern-2"], activityLog: [
      { action: "Task created", createdAt, metadata: { assigneeIds: ["intern-1", "intern-2"] } },
    ] }]);
    assert.equal(points.at(-1).score, 2);
  });

  test(`${name}: unassigned drafts, comments and cancelled work do not lift the line`, () => {
    const points = curve([
      { ...task, assignee: undefined, assigneeIds: [], activityLog: [
        { action: "Task created", createdAt, metadata: { assigneeIds: [] } },
        { action: "General comment added", createdAt },
      ], updates: [{ type: "General comment", createdAt }] },
      { ...task, status: "Cancelled" },
    ]);
    assert.equal(points.at(-1).score, 0);
    assert.equal(points.at(-1).hasProgress, false);
  });

  test(`${name}: later progress gives a bigger lift than assignment alone`, () => {
    const assigned = curve([task]).at(-1).score;
    const completed = curve([{ ...task, status: "Completed", completedAt: createdAt }]).at(-1).score;
    assert.ok(completed > assigned);
  });

  test(`${name}: an assignment at the current instant is included`, () => {
    const instant = new Date(now).toISOString();
    assert.equal(curve([{ ...task, createdDate: instant, activityLog: [
      { action: "Task created", createdAt: instant, metadata: { assigneeIds: ["intern-1"] } },
    ] }]).at(-1).score, 2);
  });
}

test("metadata-only edits and assignee removal do not produce new assignment activity", () => {
  const times = taskAssignmentTimes({ ...task, activityLog: [
    task.activityLog[0],
    { action: "Task assignment or metadata changed", createdAt: "2026-09-30T12:29:10", metadata: { assigneeIds: ["intern-1"], priority: "High" } },
    { action: "Task assignment or metadata changed", createdAt: "2026-09-30T12:29:20", metadata: { assigneeIds: [] } },
  ] });
  assert.deepEqual(times, [new Date(createdAt).getTime()]);
});

test("an existing unassigned task receives credit when an intern is assigned", () => {
  const reassigned = { ...task, createdDate: "2026-09-20T10:00:00", activityLog: [
    { action: "Task created", createdAt: "2026-09-20T10:00:00", metadata: { assigneeIds: [] } },
    { action: "Task assignment or metadata changed", createdAt, metadata: { assigneeIds: ["intern-1"] } },
  ] };
  for (const [, curve] of curves) assert.equal(curve([reassigned]).at(-1).score, 2);
});

test("explicit new-assignee metadata works without a historical creation log", () => {
  assert.deepEqual(taskAssignmentTimes({ ...task, activityLog: [
    { action: "Task assignment or metadata changed", createdAt, metadata: { assigneeIds: ["intern-1"], addedAssigneeIds: ["intern-1"] } },
    { action: "Task assignment or metadata changed", createdAt: "2026-09-30T12:29:30", metadata: { assigneeIds: ["intern-1"], addedAssigneeIds: [] } },
  ] }), [new Date(createdAt).getTime()]);
});

test("assigned legacy tasks use their actual creation timestamp once", () => {
  for (const [, curve] of curves) {
    assert.equal(curve([{ ...task, activityLog: [] }]).at(-1).score, 2);
  }
});

test("future assignments do not move any chart", () => {
  const future = "2026-10-01T10:00:00";
  for (const [, curve] of curves) {
    assert.equal(curve([{ ...task, createdDate: future, activityLog: [
      { action: "Task created", createdAt: future, metadata: { assigneeIds: ["intern-1"] } },
    ] }]).at(-1).score, 0);
  }
});

test("assignment activity does not hide a simultaneous blocker", () => {
  for (const [, curve] of curves) {
    const points = curve([{ ...task, status: "Blocked", activityLog: [
      task.activityLog[0], { action: "Status changed to Blocked", createdAt },
    ] }]);
    assert.equal(points.at(-1).score, 0);
    assert.match(points.at(-1).event, /blocked|setbacks/);
  }
});

test("a new assignment does not immediately dilute a department's existing delivery", () => {
  const completed = { createdDate: "2026-09-20T10:00:00", completedAt: "2026-09-21T10:00:00", status: "Completed" };
  const before = departmentDailyTrend([completed], now).at(-1).score;
  const after = departmentDailyTrend([completed, task], now).at(-1).score;
  assert.equal(after, before + 2);
});