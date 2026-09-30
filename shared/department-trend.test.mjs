import assert from "node:assert/strict";
import test from "node:test";
import { departmentDailyTrend } from "./department-trend.mjs";

const now = new Date("2026-09-30T12:00:00").getTime();

test("departments with no tasks show a flat zero baseline for all seven days", () => {
  const points = departmentDailyTrend([], now);
  assert.equal(points.length, 8);
  assert.ok(points.every(point => point.score === 0 && !point.hasProgress));
});

test("creating a task or leaving a comment does not count as delivery progress", () => {
  const points = departmentDailyTrend([{
    createdDate: "2026-09-29T10:00:00",
    due: "2026-10-05",
    status: "Not Started",
    updates: [{ type: "General comment", createdAt: "2026-09-30T10:00:00" }],
  }], now);
  assert.equal(points.at(-1).score, 0);
  assert.equal(points.at(-1).hasProgress, false);
});

test("completion lifts delivery, and overdue work pulls it down on quieter days", () => {
  const points = departmentDailyTrend([
    { createdDate: "2026-09-23T10:00:00", due: "2026-09-25", status: "In Progress" },
    { createdDate: "2026-09-26T10:00:00", completedAt: "2026-09-29T12:00:00", due: "2026-09-30", status: "Completed" },
  ], now);
  assert.equal(points.length, 8);
  assert.ok(points.some(point => point.direction === "up"));
  assert.ok(points.some(point => point.direction === "down"));
  assert.equal(points.at(-2).direction, "up");
});

test("blocking a task causes a drop without changing its saved status", () => {
  const points = departmentDailyTrend([{
    createdDate: "2026-09-25T10:00:00",
    due: "2026-10-10",
    status: "In Progress",
    activityLog: [
      { action: "Status changed to In Progress", createdAt: "2026-09-28T10:00:00" },
      { action: "Status changed to Blocked", createdAt: "2026-09-29T10:00:00" },
    ],
  }], now);
  assert.equal(points.at(-2).direction, "down");
});

test("unresolved overdue work cannot lift a score above zero", () => {
  const points = departmentDailyTrend([{
    createdDate: "2026-09-20T10:00:00",
    due: "2026-09-25",
    status: "In Progress",
  }], now);
  assert.equal(points.at(-1).score, 0);
  assert.equal(points.at(-1).hasProgress, false);
});