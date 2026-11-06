import { OFFICIAL_DEPARTMENTS, isOfficialDepartment, resolveDepartment } from "../../../shared/departments.mjs";
import { UNSET_TITLE } from "./schema.mjs";

const norm = (value) => String(value || "").trim().toLowerCase();

/**
 * Turns the legacy People-database columns into org rows. Pure: no database access.
 * Only facts that are explicit in the source are seeded. Guesses (name/email matches, department
 * fallbacks, duplicate identities, technical accounts) are reported for the CEO to confirm and are
 * applied only when named in `accept`.
 */
export function planSeed({ accounts, interns, opsUsers = [] }, accept = {}) {
  const acceptLinks = new Map(Object.entries(accept.links || {}));
  const acceptExclusions = new Map(Object.entries(accept.exclusions || {}));
  const acceptSupervisors = new Map(Object.entries(accept.supervisors || {}));

  const accountByEmail = new Map(accounts.map((a) => [norm(a.email), a]));
  const accountByName = new Map(accounts.map((a) => [norm(a.display_name), a]));
  const opsRoleByEmail = new Map(opsUsers.map((u) => [norm(u.email), u.role]));
  const refOf = (a) => `account-${a.id}`;

  const assignments = [];
  const relationships = [];
  const review = { technicalManagers: [], nameOnlySupervisors: [], departmentFallback: [], identityCandidates: [], completedInterns: [], inconsistentStatus: [], unsetTitles: [] };

  for (const account of accounts) {
    assignments.push({ personRef: refOf(account), title: UNSET_TITLE, department: isOfficialDepartment(account.department) ? account.department : null });
    review.unsetTitles.push(refOf(account));
    if (account.reports_to_account_id) {
      const manager = accounts.find((m) => Number(m.id) === Number(account.reports_to_account_id));
      if (manager) {
        relationships.push({ type: "reports_to", subjectRef: refOf(account), managerRef: refOf(manager), source: "reports_to_account_id" });
        if (opsRoleByEmail.get(norm(manager.email)) === "Superadmin") {
          review.technicalManagers.push({ managerRef: refOf(manager), reports: [refOf(account)] });
        }
      }
    }
  }
  const merged = new Map();
  for (const item of review.technicalManagers) merged.set(item.managerRef, [...(merged.get(item.managerRef) || []), ...item.reports]);
  review.technicalManagers = [...merged].map(([managerRef, reports]) => ({ managerRef, reports }));

  for (const intern of interns) {
    const ref = `intern-${intern.id}`;
    const resolved = resolveDepartment(intern);
    assignments.push({
      personRef: ref,
      title: String(intern.position || "").trim() || "Intern",
      department: resolved.department && isOfficialDepartment(resolved.department) ? resolved.department : null,
    });

    if (intern.supervisor_account_id) {
      const manager = accounts.find((m) => Number(m.id) === Number(intern.supervisor_account_id));
      if (manager) relationships.push({ type: "intern_supervisor", subjectRef: ref, managerRef: refOf(manager), source: "supervisor_account_id" });
    } else if (norm(intern.employment_status) === "active") {
      const byEmail = accountByEmail.get(norm(intern.supervisor_email));
      const byName = accountByName.get(norm(intern.supervisor_name));
      const match = byEmail || byName;
      if (match) {
        const proposed = refOf(match);
        review.nameOnlySupervisors.push({ internRef: ref, proposed, via: byEmail ? "supervisor_email" : "supervisor_name" });
        if (acceptSupervisors.get(ref) === proposed) relationships.push({ type: "intern_supervisor", subjectRef: ref, managerRef: proposed, source: "confirmed_match" });
      } else {
        review.departmentFallback.push(ref); // today's app guesses "any manager in the department"; we do not seed guesses
      }
    }

    // Same person recorded twice? Email is strong evidence; a bare name match is weaker. Either way it is only proposed.
    const byOwnEmail = norm(intern.email) ? accountByEmail.get(norm(intern.email)) : undefined;
    const byOwnName = accountByName.get(norm(intern.full_name));
    const sameAccount = byOwnEmail || byOwnName;
    if (sameAccount) review.identityCandidates.push({ supersededRef: ref, canonicalRef: refOf(sameAccount), via: byOwnEmail ? "email" : "name only" });
    if (norm(intern.employment_status) !== "active") review.completedInterns.push(ref);
    if (norm(intern.employment_status) === "active" && intern.completion_date && new Date(intern.completion_date) < new Date()) {
      review.inconsistentStatus.push(ref);
    }
  }

  const links = [...acceptLinks].map(([supersededRef, canonicalRef]) => ({ supersededRef, canonicalRef }));
  const exclusions = [...acceptExclusions].map(([personRef, reason]) => ({ personRef, reason }));
  return {
    departments: [...OFFICIAL_DEPARTMENTS],
    assignments, relationships, links, exclusions, review,
    pendingConfirmation: {
      identityLinks: review.identityCandidates.filter((c) => !acceptLinks.has(c.supersededRef)),
      technicalAccounts: review.technicalManagers.filter((t) => !acceptExclusions.has(t.managerRef)),
      supervisors: review.nameOnlySupervisors.filter((s) => acceptSupervisors.get(s.internRef) !== s.proposed),
    },
  };
}
