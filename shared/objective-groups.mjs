import { OFFICIAL_DEPARTMENTS, UNASSIGNED_DEPARTMENT } from "./departments.mjs";

// Group only the objectives the caller is allowed to view.
export function objectiveGroupsFor(objectives, departmentFor) {
  const groups = new Map();
  for (const objective of objectives) {
    const department = departmentFor(objective) || UNASSIGNED_DEPARTMENT;
    if (!groups.has(department)) groups.set(department, []);
    groups.get(department).push(objective);
  }
  return [...groups].sort(([a], [b]) => {
    const order = name => name === UNASSIGNED_DEPARTMENT ? 2 : OFFICIAL_DEPARTMENTS.includes(name) ? 0 : 1;
    if (order(a) !== order(b)) return order(a) - order(b);
    if (order(a) === 0) return OFFICIAL_DEPARTMENTS.indexOf(a) - OFFICIAL_DEPARTMENTS.indexOf(b);
    return a.localeCompare(b);
  }).map(([department, items]) => ({
    department,
    objectives: items.slice().sort((a, b) =>
      Number(a.status === "Complete") - Number(b.status === "Complete")
      || a.dueDate.localeCompare(b.dueDate)
      || a.title.localeCompare(b.title)
    ),
  }));
}