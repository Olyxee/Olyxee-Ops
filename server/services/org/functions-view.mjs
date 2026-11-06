// Read model for the Functions page and the home card. Built only from stored org records (via the chart),
// so leaders, members and specialisations update the moment the organisation changes. No names live here.

const byOrder = (a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name);

const unitOf = (department) => ({
  id: department.id,
  name: department.name,
  description: department.description || "",
  legacyKeys: department.legacy_keys || department.legacyKeys || [],
  parentId: department.parent_id ?? department.parentId ?? null,
  sortOrder: Number(department.sort_order ?? department.sortOrder ?? 100),
});

/** chart = result of getChart(). Members are active people assigned to the function or one of its specialisations. */
export function buildFunctionsView(chart) {
  const units = chart.departments.map(unitOf);
  const nodes = Object.values(chart.nodes);
  const leaderOf = (id) => {
    const node = nodes.find((candidate) => candidate.leadsDepartments.includes(id));
    return node ? { ref: node.ref, name: node.name, title: node.title && node.title !== "Title not set" ? node.title : null } : null;
  };
  const membersOf = (ids) => nodes.filter((node) => node.active && node.departmentId && ids.has(node.departmentId)).map((node) => node.ref);

  const functions = units.filter((unit) => !unit.parentId).sort(byOrder).map((fn) => {
    const children = units.filter((unit) => unit.parentId === fn.id).sort(byOrder);
    return {
      id: fn.id,
      name: fn.name,
      description: fn.description,
      legacyKeys: fn.legacyKeys,
      leader: leaderOf(fn.id),
      memberRefs: membersOf(new Set([fn.id, ...children.map((child) => child.id)])),
      specialisations: children.map((child) => ({
        id: child.id, name: child.name, description: child.description, legacyKeys: child.legacyKeys,
        leader: leaderOf(child.id), memberRefs: membersOf(new Set([child.id])),
      })),
    };
  });
  return { functions, version: chart.version };
}

/** Maps every name a unit has ever been stored under (legacy department names, its own name, its specialisations') to its top-level function. */
export function functionLookup(view) {
  const lookup = new Map();
  for (const fn of view.functions) {
    for (const key of [fn.name, ...fn.legacyKeys]) lookup.set(key.toLowerCase(), fn.name);
    for (const spec of fn.specialisations) for (const key of [spec.name, ...spec.legacyKeys]) lookup.set(key.toLowerCase(), fn.name);
  }
  return lookup;
}
