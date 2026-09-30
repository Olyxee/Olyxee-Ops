// The objective page is an active-work view. Completed tasks stay in the source
// collection so project history and progress never depend on this display filter.
export function objectiveWorkFor(departmentTasks, projectNames, today, projectLinksExist = false) {
  const relatedWork = projectLinksExist
    ? departmentTasks.filter(task => projectNames.includes(task.project))
    : departmentTasks;
  const supportingWork = relatedWork
    .filter(task => task.status !== "Completed" && task.status !== "Cancelled")
    .slice()
    .sort((a, b) =>
      Number(b.status === "Blocked") - Number(a.status === "Blocked")
      || Number(b.due < today) - Number(a.due < today)
      || a.due.localeCompare(b.due)
    );
  const completedCount = relatedWork.filter(task => task.status === "Completed").length;
  return {
    supportingWork,
    completedCount,
    totalCount: relatedWork.length,
    taskProgress: relatedWork.length ? Math.round(completedCount / relatedWork.length * 100) : 0,
  };
}