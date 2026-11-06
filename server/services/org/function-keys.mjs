// Existing tasks, people and objectives store a department by name. Those stored values never change; instead each
// function keeps the old names it answers to (org_departments.legacy_keys). When the UI sends a function name
// the server stores the key old records already use, so every existing filter and permission keeps working.
//
// A function can end up sharing its name with an OLD stored department (for example a function called
// "Research & Development (R&D)" while old tasks are still stored under that exact text). The two meanings are kept
// apart by where the text comes from:
//   keys:       what the UI sends (a function or team NAME) -> the key to store. Names win.
//   groups:     what is STORED on old records (legacy keys, then names) -> its top-level function. Legacy keys win.
//   nameGroups: an organisation name (a person's assigned function or team) -> its top-level function. Names win.

export async function loadFunctionKeys(db) {
  const { rows } = await db.query("SELECT id, name, legacy_keys, parent_id FROM public.org_departments WHERE active");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keys = new Map();
  const groups = new Map();
  const nameGroups = new Map();
  const rootOf = (row) => String((row.parent_id && byId.get(row.parent_id)?.name) || row.name).toLowerCase();
  const legacyOf = (row) => (Array.isArray(row.legacy_keys) ? row.legacy_keys : []);
  for (const row of rows) for (const key of legacyOf(row)) {                       // pass 1: stored (legacy) names
    keys.set(String(key).toLowerCase(), key);
    groups.set(String(key).toLowerCase(), rootOf(row));
  }
  for (const row of rows) {                                                         // pass 2: current names
    const lower = String(row.name).toLowerCase();
    keys.set(lower, legacyOf(row)[0] || row.name);                                  // UI-sent names override legacy text
    if (!groups.has(lower)) groups.set(lower, rootOf(row));                         // stored text keeps its old meaning
    nameGroups.set(lower, rootOf(row));
  }
  for (const [lower, root] of groups) if (!nameGroups.has(lower)) nameGroups.set(lower, root);
  return { keys, groups, nameGroups };
}

/**
 * True when `department` (an organisation name, e.g. a person's function) is one of `list` (text stored on a task),
 * or belongs to the same function as one of them.
 */
export function departmentInList(groups, list, department, nameGroups = groups) {
  if (!department) return false;
  const wanted = nameGroups.get(String(department).toLowerCase()) || String(department).toLowerCase();
  return list.some((item) => item === department || (groups.get(String(item).toLowerCase()) || String(item).toLowerCase()) === wanted);
}
