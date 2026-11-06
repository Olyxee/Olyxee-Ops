// Pure planning for organisational changes: no database access, so every rule is unit-testable.
// A snapshot describes the current organisation; planChange() validates a request against it and
// returns the exact rows to close/open plus before/after values for the audit trail.

export class OrgError extends Error {
  constructor(message, status = 400, code = "invalid") {
    super(message);
    this.name = "OrgError";
    this.status = status;
    this.code = code;
  }
}

const REF = /^(account|intern)-\d+$/;
export const isPersonRef = (value) => typeof value === "string" && REF.test(value);
const isEmployee = (ref) => ref.startsWith("account-");
const isIntern = (ref) => ref.startsWith("intern-");
const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const refList = (value, field) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((ref) => !isPersonRef(ref))) throw new OrgError(`${field} must be a list of person references.`);
  return [...new Set(value)];
};
const idList = (value, field) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) throw new OrgError(`${field} must be a list of ids.`);
  return [...new Set(value)];
};

/** Validates request shape. Undefined fields mean "leave unchanged"; null clears a single relationship. */
export function normalizeChange(input) {
  if (!input || typeof input !== "object") throw new OrgError("A change request is required.");
  if (!isPersonRef(input.subjectRef)) throw new OrgError("Choose a valid person.");
  const change = {
    subjectRef: input.subjectRef,
    title: input.title === undefined ? undefined : clean(input.title, 120),
    departmentId: input.departmentId === undefined ? undefined : input.departmentId,
    reportsTo: input.reportsTo === undefined ? undefined : input.reportsTo,
    internSupervisor: input.internSupervisor === undefined ? undefined : input.internSupervisor,
    functionalAdd: refList(input.functionalAdd, "functionalAdd"),
    functionalRemove: refList(input.functionalRemove, "functionalRemove"),
    leadOfAdd: idList(input.leadOfAdd, "leadOfAdd"),
    leadOfRemove: idList(input.leadOfRemove, "leadOfRemove"),
    reason: clean(input.reason, 500),
  };
  if (change.title !== undefined && !change.title) throw new OrgError("A job title cannot be empty.");
  if (change.departmentId !== undefined && change.departmentId !== null && typeof change.departmentId !== "string") throw new OrgError("Choose a valid department.");
  for (const field of ["reportsTo", "internSupervisor"]) {
    const value = change[field];
    if (value !== undefined && value !== null && !isPersonRef(value)) throw new OrgError(`Choose a valid person for ${field}.`);
  }
  const noop = change.title === undefined && change.departmentId === undefined && change.reportsTo === undefined
    && change.internSupervisor === undefined && !change.functionalAdd.length && !change.functionalRemove.length
    && !change.leadOfAdd.length && !change.leadOfRemove.length;
  if (noop) throw new OrgError("No changes were requested.");
  return change;
}

/** True when making `managerRef` the manager of `subjectRef` would create a loop in the reporting chain. */
export function wouldCreateCycle(reportsTo, subjectRef, managerRef) {
  const seen = new Set();
  for (let cursor = managerRef; cursor; cursor = reportsTo.get(cursor)) {
    if (cursor === subjectRef) return true;
    if (seen.has(cursor)) return true; // pre-existing loop: refuse to extend it
    seen.add(cursor);
  }
  return false;
}

const personLabel = (snapshot, ref) => snapshot.people.get(ref)?.name || ref;

/**
 * snapshot = {
 *   people: Map(ref -> {ref,name,active,employmentType}),
 *   departments: Map(id -> {id,name,active}),
 *   assignments: Map(ref -> {title, departmentId, positionId}),
 *   reportsTo: Map(subjectRef -> managerRef), supervisors: Map(internRef -> managerRef),
 *   functional: [{subjectRef, managerRef}], departmentLeads: Map(departmentId -> personRef)
 * }
 */
export function planChange(snapshot, change) {
  const { subjectRef } = change;
  const subject = snapshot.people.get(subjectRef);
  if (!subject) throw new OrgError("That person could not be found.", 404, "not_found");
  if (!subject.active) throw new OrgError("Organisational changes can only be made for active people.", 409, "inactive");

  const requireActiveEmployee = (ref, label) => {
    const person = snapshot.people.get(ref);
    if (!person) throw new OrgError(`${label} could not be found.`, 404, "not_found");
    if (!person.active) throw new OrgError(`${label} is not active.`, 409, "inactive");
    if (!isEmployee(ref)) throw new OrgError(`${label} must be an employee.`, 409, "ineligible");
    return person;
  };

  const before = {};
  const after = {};
  const ops = { assignment: null, closeRelationships: [], openRelationships: [], closeLeads: [], openLeads: [] };
  const currentAssignment = snapshot.assignments.get(subjectRef) || null;

  // Title and department
  if (change.title !== undefined || change.departmentId !== undefined) {
    const nextDepartmentId = change.departmentId === undefined ? currentAssignment?.departmentId ?? null : change.departmentId;
    if (nextDepartmentId !== null) {
      const department = snapshot.departments.get(nextDepartmentId);
      if (!department || !department.active) throw new OrgError("Choose an active department.", 400, "department");
    }
    const nextTitle = change.title === undefined ? currentAssignment?.title : change.title;
    if (!nextTitle) throw new OrgError("A job title is required.");
    if (nextTitle !== currentAssignment?.title || nextDepartmentId !== (currentAssignment?.departmentId ?? null)) {
      before.title = currentAssignment?.title ?? null;
      before.departmentId = currentAssignment?.departmentId ?? null;
      after.title = nextTitle;
      after.departmentId = nextDepartmentId;
      ops.assignment = { title: nextTitle, departmentId: nextDepartmentId, positionId: change.positionId ?? null };
    }
  }

  // Organisational reporting line (employees only; interns are supervised, not line-managed)
  if (change.reportsTo !== undefined) {
    if (!isEmployee(subjectRef)) throw new OrgError("Interns are assigned a supervisor, not a reporting manager.", 409, "ineligible");
    const current = snapshot.reportsTo.get(subjectRef) ?? null;
    if (change.reportsTo !== current) {
      if (change.reportsTo !== null) {
        if (change.reportsTo === subjectRef) throw new OrgError("A person cannot report to themselves.", 409, "cycle");
        requireActiveEmployee(change.reportsTo, "The reporting manager");
        if (wouldCreateCycle(snapshot.reportsTo, subjectRef, change.reportsTo)) {
          throw new OrgError(`${personLabel(snapshot, change.reportsTo)} already reports (directly or indirectly) to ${personLabel(snapshot, subjectRef)}, so this would create a circular hierarchy.`, 409, "cycle");
        }
      }
      before.reportsTo = current;
      after.reportsTo = change.reportsTo;
      if (current) ops.closeRelationships.push({ type: "reports_to", subjectRef, managerRef: current });
      if (change.reportsTo) ops.openRelationships.push({ type: "reports_to", subjectRef, managerRef: change.reportsTo });
    }
  }

  // Internship supervision (separate from line management)
  if (change.internSupervisor !== undefined) {
    if (!isIntern(subjectRef)) throw new OrgError("Only interns have an internship supervisor.", 409, "ineligible");
    const current = snapshot.supervisors.get(subjectRef) ?? null;
    if (change.internSupervisor !== current) {
      if (change.internSupervisor !== null) requireActiveEmployee(change.internSupervisor, "The supervisor");
      before.internSupervisor = current;
      after.internSupervisor = change.internSupervisor;
      if (current) ops.closeRelationships.push({ type: "intern_supervisor", subjectRef, managerRef: current });
      if (change.internSupervisor) ops.openRelationships.push({ type: "intern_supervisor", subjectRef, managerRef: change.internSupervisor });
    }
  }

  // Functional (dotted-line) leadership of this person
  const functionalNow = new Set(snapshot.functional.filter((item) => item.subjectRef === subjectRef).map((item) => item.managerRef));
  const functionalAdd = change.functionalAdd.filter((ref) => !functionalNow.has(ref));
  const functionalRemove = change.functionalRemove.filter((ref) => functionalNow.has(ref));
  for (const ref of functionalAdd) {
    if (ref === subjectRef) throw new OrgError("A person cannot be their own functional lead.", 409, "cycle");
    requireActiveEmployee(ref, "The functional lead");
    ops.openRelationships.push({ type: "functional_lead", subjectRef, managerRef: ref });
  }
  for (const ref of functionalRemove) ops.closeRelationships.push({ type: "functional_lead", subjectRef, managerRef: ref });
  if (functionalAdd.length || functionalRemove.length) {
    before.functionalLeads = [...functionalNow].sort();
    after.functionalLeads = [...new Set([...functionalNow, ...functionalAdd])].filter((ref) => !functionalRemove.includes(ref)).sort();
  }

  // Department leadership (appoint / replace / remove) held by this person
  const ledNow = new Set([...snapshot.departmentLeads].filter(([, ref]) => ref === subjectRef).map(([id]) => id));
  for (const id of change.leadOfAdd) {
    const department = snapshot.departments.get(id);
    if (!department || !department.active) throw new OrgError("Choose an active department to lead.", 400, "department");
    if (!isEmployee(subjectRef)) throw new OrgError("Only employees can lead a department.", 409, "ineligible");
    if (ledNow.has(id)) continue;
    const incumbent = snapshot.departmentLeads.get(id);
    if (incumbent) ops.closeLeads.push({ departmentId: id, personRef: incumbent }); // replacing the lead keeps their history
    ops.openLeads.push({ departmentId: id, personRef: subjectRef });
  }
  for (const id of change.leadOfRemove) {
    if (ledNow.has(id)) ops.closeLeads.push({ departmentId: id, personRef: subjectRef });
  }
  if (ops.openLeads.length || ops.closeLeads.length) {
    const after_ = new Set(ledNow);
    ops.openLeads.forEach((lead) => after_.add(lead.departmentId));
    ops.closeLeads.filter((lead) => lead.personRef === subjectRef).forEach((lead) => after_.delete(lead.departmentId));
    before.leadOf = [...ledNow].sort();
    after.leadOf = [...after_].sort();
    const replaced = ops.closeLeads.filter((lead) => lead.personRef !== subjectRef);
    if (replaced.length) after.replacedLeads = replaced;
  }

  const changed = ops.assignment || ops.closeRelationships.length || ops.openRelationships.length || ops.openLeads.length || ops.closeLeads.length;
  if (!changed) throw new OrgError("Nothing would change.", 409, "no_change");

  // Visible summary used by the review step
  const summary = [];
  if (after.title !== undefined && before.title !== after.title) summary.push(`Title: ${before.title ?? "none"} → ${after.title}`);
  if (after.departmentId !== undefined && before.departmentId !== after.departmentId) {
    const name = (id) => (id ? snapshot.departments.get(id)?.name || id : "none");
    summary.push(`Department: ${name(before.departmentId)} → ${name(after.departmentId)}`);
  }
  if ("reportsTo" in after) summary.push(`Reports to: ${before.reportsTo ? personLabel(snapshot, before.reportsTo) : "none"} → ${after.reportsTo ? personLabel(snapshot, after.reportsTo) : "none"}`);
  if ("internSupervisor" in after) summary.push(`Intern supervisor: ${before.internSupervisor ? personLabel(snapshot, before.internSupervisor) : "none"} → ${after.internSupervisor ? personLabel(snapshot, after.internSupervisor) : "none"}`);
  if ("functionalLeads" in after) summary.push(`Functional leads: ${after.functionalLeads.map((ref) => personLabel(snapshot, ref)).join(", ") || "none"}`);
  if ("leadOf" in after) summary.push(`Leads departments: ${after.leadOf.map((id) => snapshot.departments.get(id)?.name || id).join(", ") || "none"}`);

  return { subjectRef, before, after, ops, summary, affectedRefs: affectedPeople(snapshot, subjectRef, ops) };
}

/** People who should hear about the change: the subject, old/new managers and anyone newly named. */
function affectedPeople(snapshot, subjectRef, ops) {
  const refs = new Set([subjectRef]);
  [...ops.closeRelationships, ...ops.openRelationships].forEach((item) => refs.add(item.managerRef));
  ops.openLeads.forEach((lead) => refs.add(lead.personRef));
  ops.closeLeads.forEach((lead) => refs.add(lead.personRef));
  return [...refs];
}
