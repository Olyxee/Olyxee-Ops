// Delivery numbers for a function. Pure, so the rules are testable:
//  - cancelled work is not counted;
//  - a function with no measurable work has no percentage (null), never a made-up 0%;
//  - a task shared by several functions counts once in each function, and company-wide totals count it exactly once.

export const mapDepartmentNames = (names, functionOf) => [...new Set((names || []).filter(Boolean).map((name) => functionOf(name)))];

export function functionDelivery(tasks) {
  const live = tasks.filter((task) => task.status !== "Cancelled");
  const completed = live.filter((task) => task.status === "Completed").length;
  return {
    total: live.length,
    completed,
    open: live.length - completed,
    blocked: live.filter((task) => task.status === "Blocked").length,
    completionPercent: live.length ? Math.round((completed / live.length) * 100) : null,
  };
}

/** Company-wide figures are taken from the tasks themselves, never by adding the functions together. */
export const companyDelivery = (tasks) => functionDelivery(tasks);
