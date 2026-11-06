import { UNASSIGNED_DEPARTMENT } from "../../../shared/departments.mjs";
import { UNSET_TITLE } from "./schema.mjs";

/** Reads the current org tables once; /api/people merges them into the people it already builds. */
export async function loadOrgOverlayData(db) {
  const [departments, assignments, relationships, links, exclusions, classifications] = await Promise.all([
    db.query("SELECT id, name FROM public.org_departments"),
    db.query("SELECT person_ref, title, department_id FROM public.org_assignments WHERE effective_to IS NULL"),
    db.query("SELECT type, subject_ref, manager_ref FROM public.org_relationships WHERE effective_to IS NULL AND type IN ('reports_to','intern_supervisor')"),
    db.query("SELECT superseded_ref, canonical_ref FROM public.org_identity_links"),
    db.query("SELECT person_ref FROM public.org_chart_exclusions"),
    db.query("SELECT person_ref, employment_type FROM public.org_person_classification"),
  ]);
  return {
    departments: new Map(departments.rows.map((row) => [row.id, row.name])),
    assignments: new Map(assignments.rows.map((row) => [row.person_ref, row])),
    managerOf: new Map(relationships.rows.map((row) => [row.subject_ref, row.manager_ref])),
    hidden: new Set([...links.rows.map((row) => row.superseded_ref), ...exclusions.rows.map((row) => row.person_ref)]),
    canonical: new Map(links.rows.map((row) => [row.superseded_ref, row.canonical_ref])),
    classification: new Map(classifications.rows.map((row) => [row.person_ref, row.employment_type])),
  };
}

/**
 * Title, department and reporting come from the org tables. Identity, status and access stay as the
 * existing code built them. Hiding is driven by data (identity links / exclusions), never by name.
 */
export function applyOrgOverlay(people, data) {
  const byId = new Map(people.map((person) => [person.id, person]));
  return people
    .filter((person) => !data.hidden.has(person.id))
    .map((person) => {
      const assignment = data.assignments.get(person.id);
      const managerRef = data.managerOf.get(person.id);
      const manager = managerRef ? byId.get(managerRef) : undefined;
      const next = { ...person, reportsTo: managerRef || undefined, orgManaged: true };
      const classified = data.classification?.get(person.id);
      if (classified) { next.employmentType = classified; if (classified === "Employee" && person.role === "Intern") next.role = "Member"; }
      if (assignment) {
        next.position = assignment.title || UNSET_TITLE;
        next.department = assignment.department_id ? data.departments.get(assignment.department_id) || person.department : UNASSIGNED_DEPARTMENT;
      } else {
        next.position = UNSET_TITLE;
      }
      if (next.employmentType === "Intern") next.supervisorName = manager?.name || "";
      return next;
    });
}
