// Count recorded assignment events, not comments or edits to due dates/priority.
// A task assigned to several people earns one small activity lift, not one per person.
export function taskAssignmentTimes(task) {
  if (task.status === "Cancelled") return [];
  const activities = (task.activityLog || [])
    .filter(activity => ["Task created", "Task assignment or metadata changed"].includes(activity.action))
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const times = [];
  let previousIds = null;
  for (const activity of activities) {
    const ids = Array.isArray(activity.metadata?.assigneeIds) ? activity.metadata.assigneeIds.filter(Boolean) : null;
    const addedIds = activity.metadata?.addedAssigneeIds;
    const assigned = activity.action === "Task created"
      ? Boolean(ids?.length)
      : Array.isArray(addedIds)
        ? addedIds.length > 0
        : ids !== null && previousIds !== null && ids.some(id => !previousIds.includes(id));
    const time = new Date(activity.createdAt).getTime();
    if (assigned && Number.isFinite(time)) times.push(time);
    if (ids !== null) previousIds = ids;
  }
  // Older task rows may predate the activity log. Use their actual creation time.
  if (!activities.length && (task.assignee || task.assigneeIds?.length)) {
    const created = task.createdDate ? new Date(task.createdDate).getTime() : NaN;
    if (Number.isFinite(created)) times.push(created);
  }
  return [...new Set(times)];
}