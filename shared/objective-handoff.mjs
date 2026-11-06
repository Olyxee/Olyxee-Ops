// Weekly objectives passed up to a function leader, and the CEO's view of only the major ones.
//
//  - handOffObjectives: moves every objective's owner (managerId) to one person and remembers who owned it before in
//    teamLeadId, so the new owner can still see which team has what left to do. Nothing else is touched, and running it
//    again changes nothing.
//  - majorObjectives: the objectives owned by the people who report directly to the viewer.

export function handOffObjectives(objectives, toRef) {
  const changed = [];
  const next = objectives.map((objective) => {
    if (objective.managerId === toRef) return objective;
    changed.push({ id: objective.id, title: objective.title, from: objective.managerId, status: objective.status });
    return { ...objective, teamLeadId: objective.teamLeadId || objective.managerId, managerId: toRef };
  });
  return { objectives: next, changed };
}

/** When the viewer has direct links, only their objectives are "major"; with none, everything stays visible. */
export function majorObjectives(objectives, directLinkIds) {
  if (!directLinkIds.length) return objectives;
  const owners = new Set(directLinkIds);
  return objectives.filter((objective) => owners.has(objective.managerId));
}

/** The team an objective belongs to, shown only when it differs from the owner. */
export const objectiveTeamLeadId = (objective) => (objective.teamLeadId && objective.teamLeadId !== objective.managerId ? objective.teamLeadId : null);
