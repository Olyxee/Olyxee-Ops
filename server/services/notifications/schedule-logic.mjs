export function utcDate(value) {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return date.toISOString().slice(0, 10);
}

export function reminderDays(plannedEndDate, today = new Date()) {
  if (!plannedEndDate) return [];
  const end = new Date(`${utcDate(plannedEndDate)}T00:00:00Z`);
  const now = new Date(`${utcDate(today)}T00:00:00Z`);
  const days = Math.round((end - now) / 86400000);
  return [14, 7].filter((offset) => days === offset);
}

export function weeklySummary({ assigned = 0, completed = 0, inProgress = 0, awaitingReview = 0, overdue = 0, recentProgress = 0, unresolvedHelp = 0 } = {}) {
  return { assigned, completed, inProgress, awaitingReview, overdue, recentProgress, unresolvedHelp };
}

export function taskReminderKey(kind, taskId, dueDate, assigneeId) {
  return `task-${kind}:${taskId}:${dueDate}:${assigneeId}`;
}