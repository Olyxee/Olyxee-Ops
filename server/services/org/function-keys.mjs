// Existing tasks, people and objectives store a department by name. Those stored values never change; instead each
// function keeps the old names it answers to (org_departments.legacy_keys). When the UI sends a function name
// the server stores the key old records already use, so every existing filter and permission keeps working.
//
// keys:   any name (function, specialisation or legacy key, lower-cased) -> the key to store
// groups: any of those names (lower-cased) -> its top-level function (lower-cased), so a manager of a specialisation
//         still counts as being in the function.

/** True when `department` is one of `list`, or belongs to the same function as one of them (groups from loadFunctionKeys). */
export function departmentInList(groups, list, department) {
  if (!department) return false;
  const group = (value) => groups.get(String(value).toLowerCase()) || String(value).toLowerCase();
  const wanted = group(department);
  return list.some((item) => item === department || group(item) === wanted);
}

export async function loadFunctionKeys(db) {
  const { rows } = await db.query("SELECT id, name, legacy_keys, parent_id FROM public.org_departments WHERE active");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keys = new Map();
  const groups = new Map();
  for (const row of rows) {
    const legacy = Array.isArray(row.legacy_keys) ? row.legacy_keys : [];
    const root = String((row.parent_id && byId.get(row.parent_id)?.name) || row.name).toLowerCase();
    for (const key of legacy) { keys.set(String(key).toLowerCase(), key); groups.set(String(key).toLowerCase(), root); }
    keys.set(String(row.name).toLowerCase(), legacy[0] || row.name);
    groups.set(String(row.name).toLowerCase(), root);
  }
  return { keys, groups };
}
