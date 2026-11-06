// How each team of a function is doing this week. A task belongs to a team when it is assigned to someone on that team
// (its members or its leader), so a task is counted once per team that is working on it. Only completed work is counted.
// The week starts on Monday; "last week" is measured up to the same point in the week so the comparison is fair.

const assigneesOf = (task) => (task.assigneeIds?.length ? task.assigneeIds : task.assignee ? [task.assignee] : []);

/**
 * teams: [{ name, leaderName, description, leaderRef, memberRefs }] in the order they should be shown.
 * Returns rows in the same order: { department: [name, leaderName, description], currentCompleted, previousCompleted, change }.
 */
export function teamWeeklyPerformance(teams, tasks, nowMs) {
  const now = new Date(nowMs);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const previousWeekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7);
  const previousCutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return teams.map((team) => {
    const people = new Set([...(team.memberRefs || []), ...(team.leaderRef ? [team.leaderRef] : [])]);
    const done = (start, end) => tasks.filter((task) => {
      if (task.status !== "Completed" || !assigneesOf(task).some((id) => people.has(id))) return false;
      const at = task.completedAt ? new Date(task.completedAt).getTime() : NaN;
      return Number.isFinite(at) && at >= start && at <= end;
    }).length;
    const currentCompleted = done(weekStart.getTime(), nowMs);
    const previousCompleted = done(previousWeekStart.getTime(), previousCutoff.getTime());
    return { department: [team.name, team.leaderName || "Unassigned", team.description || ""], currentCompleted, previousCompleted, change: currentCompleted - previousCompleted };
  });
}
