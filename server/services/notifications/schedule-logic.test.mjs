import test from "node:test";
import assert from "node:assert/strict";
import { reminderDays, taskReminderKey, weeklySummary } from "./schedule-logic.mjs";

test("internship reminders fire exactly at fourteen and seven days", () => {
  assert.deepEqual(reminderDays("2026-04-15", "2026-04-01"), [14]);
  assert.deepEqual(reminderDays("2026-04-08", "2026-04-01"), [7]);
  assert.deepEqual(reminderDays("2026-04-09", "2026-04-01"), []);
});

test("weekly summary preserves factual category counts", () => {
  assert.deepEqual(weeklySummary({ assigned: 3, completed: 1, inProgress: 1, awaitingReview: 1, overdue: 2, recentProgress: 4, unresolvedHelp: 1 }), {
    assigned: 3, completed: 1, inProgress: 1, awaitingReview: 1, overdue: 2, recentProgress: 4, unresolvedHelp: 1,
  });
});

test("task reminder keys are stable per assignee and distinct across assignees", () => {
  const first = taskReminderKey("due-soon", "task-1", "2026-09-21", "intern-1");
  const duplicate = taskReminderKey("due-soon", "task-1", "2026-09-21", "intern-1");
  const second = taskReminderKey("due-soon", "task-1", "2026-09-21", "intern-2");
  assert.equal(first, duplicate);
  assert.notEqual(first, second);
});