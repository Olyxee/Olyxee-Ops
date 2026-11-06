import { UNSET_TITLE } from "./schema.mjs";

// Builds the organisational chart purely from stored records. Nothing here is hand-maintained:
// the same function serves the chart endpoint and the integrity report.

/**
 * input = {
 *   people: [{ref,name,email,employmentType,active,status}],
 *   departments: [{id,name,active}],
 *   assignments: [{personRef,title,departmentId}],               // current (or as-of) rows
 *   relationships: [{type,subjectRef,managerRef}],               // current (or as-of) rows
 *   departmentLeads: [{departmentId,personRef}],
 *   identityLinks: [{supersededRef,canonicalRef}],
 *   exclusions: [{personRef,reason}],
 * }
 */
export function buildChart(input, { includeAlumni = false } = {}) {
  const departments = new Map(input.departments.map((department) => [department.id, department]));
  const superseded = new Set(input.identityLinks.map((link) => link.supersededRef));
  const excluded = new Map(input.exclusions.map((item) => [item.personRef, item.reason]));
  const canonical = (ref) => input.identityLinks.find((link) => link.supersededRef === ref)?.canonicalRef || ref;
  const assignments = new Map();
  // A merged duplicate must never override the person's own record: apply superseded rows first.
  const isSuperseded = (ref) => canonical(ref) !== ref;
  for (const item of [...input.assignments].sort((a, b) => Number(isSuperseded(b.personRef)) - Number(isSuperseded(a.personRef)))) assignments.set(canonical(item.personRef), item);

  const issues = [];
  const nodes = new Map();
  for (const person of input.people) {
    if (superseded.has(person.ref) || excluded.has(person.ref)) continue;
    const isAlumnus = person.employmentType === "Intern" && !person.active;
    if (isAlumnus && !includeAlumni) continue;
    const assignment = assignments.get(person.ref);
    const department = assignment?.departmentId ? departments.get(assignment.departmentId) : undefined;
    nodes.set(person.ref, {
      ref: person.ref,
      name: person.name,
      employmentType: person.employmentType,
      active: person.active,
      status: person.status,
      title: assignment?.title || null,
      departmentId: assignment?.departmentId || null,
      department: department?.name || null,
      reportsTo: null,
      internSupervisor: null,
      functionalLeads: [],
      directReports: [],
      supervisedInterns: [],
      functionalReports: [],
      leadsDepartments: [],
    });
    if (!assignment || assignment.title === UNSET_TITLE) issues.push({ code: "no_title", ref: person.ref, message: `${person.name} has no recorded title.` });
  }

  for (const link of input.relationships) {
    const subjectRef = canonical(link.subjectRef);
    const managerRef = canonical(link.managerRef);
    const subject = nodes.get(subjectRef);
    const manager = nodes.get(managerRef);
    if (!subject) continue; // hidden (alumnus, system or superseded) subjects do not appear
    if (!manager) {
      issues.push({ code: "manager_hidden", ref: subjectRef, message: `${subject.name}'s ${link.type.replace("_", " ")} is not shown in the chart.` });
      continue;
    }
    if (link.type === "reports_to") { subject.reportsTo = managerRef; manager.directReports.push(subjectRef); }
    else if (link.type === "intern_supervisor") { subject.internSupervisor = managerRef; manager.supervisedInterns.push(subjectRef); }
    else if (link.type === "functional_lead") { subject.functionalLeads.push(managerRef); manager.functionalReports.push(subjectRef); }
  }
  for (const lead of input.departmentLeads) {
    const node = nodes.get(canonical(lead.personRef));
    if (node && departments.get(lead.departmentId)) node.leadsDepartments.push(lead.departmentId);
  }

  for (const node of nodes.values()) {
    if (node.employmentType === "Intern" && node.active && !node.internSupervisor) {
      issues.push({ code: "no_supervisor", ref: node.ref, message: `${node.name} has no internship supervisor.` });
    }
    if (node.employmentType !== "Intern" && node.active && !node.reportsTo && node.directReports.length === 0) {
      issues.push({ code: "no_manager", ref: node.ref, message: `${node.name} has no reporting manager.` });
    }
  }

  const byName = (a, b) => nodes.get(a).name.localeCompare(nodes.get(b).name);
  for (const node of nodes.values()) {
    node.directReports.sort(byName);
    node.supervisedInterns.sort(byName);
    node.functionalReports.sort(byName);
  }
  const roots = [...nodes.values()]
    .filter((node) => node.employmentType !== "Intern" && !node.reportsTo)
    .map((node) => node.ref)
    .sort(byName);

  // Anything unreachable from a root is part of a loop (should be impossible; reported if legacy data creates one).
  const reached = new Set();
  const stack = [...roots];
  while (stack.length) {
    const ref = stack.pop();
    if (reached.has(ref)) continue;
    reached.add(ref);
    stack.push(...nodes.get(ref).directReports);
  }
  for (const node of nodes.values()) {
    if (node.employmentType !== "Intern" && !reached.has(node.ref)) {
      issues.push({ code: "cycle", ref: node.ref, message: `${node.name} is part of a circular reporting chain.` });
    }
  }

  return {
    nodes: Object.fromEntries(nodes),
    roots,
    departments: [...departments.values()].filter((department) => department.active),
    issues,
    counts: {
      people: nodes.size,
      employees: [...nodes.values()].filter((node) => node.employmentType !== "Intern").length,
      interns: [...nodes.values()].filter((node) => node.employmentType === "Intern").length,
    },
  };
}
