import { taskAssignmentTimes } from "./task-assignment-events.mjs";

// A seven-day delivery/activity trend based on dated task events, not sampled noise.
export function departmentDailyTrend(tasks, now) {
  const today = new Date(now);
  const firstDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const timestamp = (value) => {
    if (!value) return NaN;
    const parsed = new Date(value);
    return parsed.getTime();
  };
  const within = (value, start, end) => Number.isFinite(value) && value >= start && value < end && value <= now;
  const assignmentTimes = tasks.flatMap(taskAssignmentTimes);
  const earlierTasks = tasks.filter(task => timestamp(task.createdDate || task.startDate) < firstDay.getTime() && task.status !== "Cancelled");
  let score = earlierTasks.length
    ? Math.round(earlierTasks.filter(task => timestamp(task.completedAt) < firstDay.getTime()).length / earlierTasks.length * 70)
    : 0;
  const points = [{ label: "Start", score, event: "Delivery health before this week", direction: "steady", hasProgress: false }];

  for (let day = 0; day < 7; day++) {
    const start = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + day).getTime();
    if (start > now) break;
    const end = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + day + 1).getTime();
    const cutoff = Math.min(end, now);
    let positive = 0;
    let negative = 0;
    let progress = 0;
    let setbacks = 0;
    let active = 0;
    let known = 0;
    let finished = 0;
    const assignments = assignmentTimes.filter(value => within(value, start, end)).length;
    positive += assignments * 2;

    for (const task of tasks) {
      const created = timestamp(task.createdDate || task.startDate);
      const completed = timestamp(task.completedAt);
      const submitted = timestamp(task.submittedAt);
      const due = task.due ? timestamp(`${task.due}T23:59:59.999`) : NaN;
      // New unstarted tasks should not dilute existing delivery on their assignment day.
      if (created <= cutoff && (created < start || completed <= cutoff) && task.status !== "Cancelled") {
        known++;
        if (completed < cutoff) finished++;
      }
      if (within(submitted, start, cutoff)) { positive += 4; progress++; }
      if (within(completed, start, cutoff)) { positive += 10; progress++; }
      for (const update of task.updates || []) {
        if (!within(timestamp(update.createdAt), start, cutoff)) continue;
        if (["Submission", "Resubmission"].includes(update.type)) { positive += 3; progress++; }
      }
      for (const item of task.checklist || []) {
        if (item.completed && within(timestamp(item.completedAt), start, cutoff)) { positive += 2; progress++; }
      }
      for (const activity of task.activityLog || []) {
        if (!within(timestamp(activity.createdAt), start, cutoff)) continue;
        if (activity.action === "Status changed to In Progress") { positive += 3; progress++; }
        if (activity.action === "Evidence added") { positive += 2; progress++; }
        if (activity.action === "Status changed to Blocked") { negative += 10; setbacks++; }
        if (activity.action === "Status changed to Changes Requested") { negative += 8; setbacks++; }
        if (activity.action === "Checklist item reopened") { negative += 3; setbacks++; }
      }
      const unfinishedAtCutoff = (!Number.isFinite(completed) || completed >= cutoff) && task.status !== "Cancelled";
      if (created < cutoff && unfinishedAtCutoff) {
        active++;
        if (Number.isFinite(due) && due < cutoff) {
          const daysLate = Math.max(1, Math.ceil((cutoff - due) / 86400000));
          negative += 5 + Math.min(12, (daysLate - 1) * 2);
          if (due >= start) setbacks++;
        }
      }
    }
    // Compare each day's delivery, rather than accumulating updates until the chart hits its ceiling.
    const nextScore = Math.round(Math.max(0, Math.min(96,
      (known ? finished / known * 70 : 0)
      + Math.min(30, positive) - Math.min(45, negative)
      - (!progress && !assignments && active ? 2 : 0)
    )));
    const change = nextScore - score;
    score = nextScore;
    points.push({
      label: new Date(start).toLocaleDateString(undefined, { weekday: "short" }),
      score,
      event: progress || setbacks || assignments ? `${assignments} task assignments, ${progress} delivery events, ${setbacks} setbacks` : active ? "No progress recorded on active work" : tasks.length ? "No progress recorded today" : "No tasks recorded",
      direction: change > 0 ? "up" : change < 0 ? "down" : "steady",
      hasProgress: progress > 0 || assignments > 0,
    });
  }
  return points;
}