import { taskAssignmentTimes } from "./task-assignment-events.mjs";

export function departmentHourlyTrend(tasks, now, maxHours) {
  const hour = 60 * 60 * 1000;
  const current = new Date(now);
  const currentHourStart = new Date(current.getFullYear(), current.getMonth(), current.getDate(), current.getHours()).getTime();
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const daysSinceMonday = (current.getDay() + 6) % 7;
  const weekStart = dayStart - daysSinceMonday * 24 * hour;
  const elapsedWeekHours = Math.floor((currentHourStart - weekStart) / hour) + 1;
  const hours = Math.max(2, maxHours || elapsedWeekHours);
  const windowStart = maxHours ? currentHourStart - (hours - 1) * hour : weekStart;
  const time = value => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime() : NaN;
  const formatHour = value => new Date(value).toLocaleDateString([], { weekday: "short", hour: "numeric" });
  const assignmentTimes = tasks.flatMap(taskAssignmentTimes);
  let score = 0;
  const startPoint = { label: "", score, event: "No activity at the start of this window", direction: "steady", hasProgress: false };
  const hourlyPoints = Array.from({ length: hours }, (_, index) => {
    const start = windowStart + index * hour;
    const cutoff = Math.min(start + hour - 1, now);
    const inHour = value => Number.isFinite(value) && value >= start && value <= cutoff;
    const assigned = assignmentTimes.filter(inHour).length;
    const completed = tasks.filter(task => inHour(time(task.completedAt))).length;
    const submitted = tasks.filter(task => inHour(time(task.submittedAt))).length;
    const updatesInHour = tasks.flatMap(task => (task.updates || []).filter(update => inHour(time(update.createdAt))));
    const updated = updatesInHour.filter(update => ["Submission", "Resubmission"].includes(update.type)).length;
    const activityInHour = tasks.flatMap(task => (task.activityLog || []).filter(activity => inHour(time(activity.createdAt))));
    const blocked = activityInHour.filter(activity => activity.action === "Status changed to Blocked").length;
    const changesRequested = activityInHour.filter(activity => activity.action === "Status changed to Changes Requested").length;
    const reopened = activityInHour.filter(activity => activity.action === "Checklist item reopened").length;
    const deliveryActivity = activityInHour.filter(activity => ["Status changed to In Progress", "Evidence added"].includes(activity.action)).length;
    const checklistCompleted = tasks.flatMap(task => (task.checklist || []).filter(item => item.completed && inHour(time(item.completedAt)))).length;
    const overdue = tasks.filter(task => {
      if (["Completed", "Cancelled"].includes(task.status)) return false;
      const dueAt = new Date(`${task.due}T00:00:00`).getTime() + 24 * hour;
      return dueAt >= start && dueAt <= cutoff;
    }).length;
    const positive = assigned * 2 + submitted * 6 + completed * 10 + updated * 4 + deliveryActivity * 3 + checklistCompleted * 2;
    const negative = blocked * 8 + changesRequested * 6 + reopened * 3 + overdue * 5;
    const previous = score;
    score = Math.max(0, Math.min(96, score + positive - negative));
    const direction = score > previous ? "up" : score < previous ? "down" : "steady";
    const deliveryEvent = completed ? `${completed} ${completed === 1 ? "task" : "tasks"} completed` : submitted ? `${submitted} sent for review` : checklistCompleted ? `${checklistCompleted} checklist ${checklistCompleted === 1 ? "item" : "items"} completed` : updated ? `${updated} submission ${updated === 1 ? "update" : "updates"}` : deliveryActivity ? `${deliveryActivity} delivery ${deliveryActivity === 1 ? "event" : "events"}` : blocked ? `${blocked} ${blocked === 1 ? "task" : "tasks"} blocked` : changesRequested ? `${changesRequested} sent back for changes` : reopened ? `${reopened} checklist ${reopened === 1 ? "item" : "items"} reopened` : overdue ? `${overdue} ${overdue === 1 ? "task became" : "tasks became"} overdue` : "";
    const assignmentEvent = assigned ? `${assigned} task ${assigned === 1 ? "assignment" : "assignments"} recorded` : "";
    const event = [deliveryEvent, assignmentEvent].filter(Boolean).join("; ") || "No recorded work activity";
    return { label: formatHour(start), score, event, direction, hasProgress: positive > 0 };
  });
  return [startPoint, ...hourlyPoints];
}