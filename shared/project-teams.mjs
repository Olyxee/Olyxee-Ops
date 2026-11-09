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

/** Units (a function or one of its specialisations) of the project's teams that this person leads. */
export function unitsLedOnProject(view, project, ref) {
  const wanted = new Set(project.teamIds || []);
  return view.functions.filter((fn) => wanted.has(fn.id)).flatMap(unitsOf).filter((unit) => unit.leader?.ref === ref);
}

/** True when the person leads any part of a team the CEO put on the project (they can see it and pick people for it). */
export const leadsTeamOnProject = (view, project, ref) => unitsLedOnProject(view, project, ref).length > 0;

/**
 * People this leader may add to or remove from the project: the members of the parts of the assigned teams they lead.
 * Leading a whole function covers all of it; leading one specialisation covers only that specialisation.
 */
export function assignableByLeader(view, project, ref) {
  const refs = new Set();
  for (const unit of unitsLedOnProject(view, project, ref)) unit.memberRefs.forEach((member) => refs.add(member));
  refs.delete(ref);                  // a leader assigns their people; they are on the project through their team
  return refs;
}

/** Everyone whose directory entry a leader needs: the members of every unit they lead. */
export function peopleLedBy(view, ref) {
  const refs = new Set();
  for (const fn of view.functions) for (const unit of unitsOf(fn)) if (unit.leader?.ref === ref) unit.memberRefs.forEach((member) => refs.add(member));
  return refs;
}

/** Teams that exist and are top-level functions; anything else is dropped. */
export function validTeamIds(view, teamIds) {
  const known = new Set(view.functions.map((fn) => fn.id));
  return [...new Set((Array.isArray(teamIds) ? teamIds : []).map(String))].filter((id) => known.has(id));
}
