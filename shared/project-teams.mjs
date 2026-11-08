// Who may be put on a project. The CEO assigns whole teams (functions); the leader of an assigned team picks the
// people from that team. Works on the read model from buildFunctionsView() so it follows the live organisation.

const unitsOf = (fn) => [fn, ...(fn.specialisations || [])];

/** Every active member of the given teams (a team includes its specialisations). */
export function teamMemberRefs(view, teamIds = []) {
  const wanted = new Set(teamIds);
  const refs = new Set();
  for (const fn of view.functions) if (wanted.has(fn.id)) for (const unit of unitsOf(fn)) unit.memberRefs.forEach((ref) => refs.add(ref));
  return refs;
}

/** Teams (top-level function ids) whose leader, or a specialisation's leader, is this person. */
export function teamsLedBy(view, ref) {
  return view.functions.filter((fn) => unitsOf(fn).some((unit) => unit.leader?.ref === ref)).map((fn) => fn.id);
}

/** People this manager may add to or remove from the project: members of the assigned teams that they lead. */
export function assignableByLeader(view, project, ref) {
  const led = new Set(teamsLedBy(view, ref));
  const ids = (project.teamIds || []).filter((id) => led.has(id));
  const refs = teamMemberRefs(view, ids);
  refs.delete(ref);                  // a leader assigns their people; they are on the project through their team
  return refs;
}

/** Teams that exist and are top-level functions; anything else is dropped. */
export function validTeamIds(view, teamIds) {
  const known = new Set(view.functions.map((fn) => fn.id));
  return [...new Set((Array.isArray(teamIds) ? teamIds : []).map(String))].filter((id) => known.has(id));
}
