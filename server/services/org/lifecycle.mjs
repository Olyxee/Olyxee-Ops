import { OrgError } from "./plan.mjs";

/**
 * Initial org record for a person who was just added to the People database.
 * Only explicit inputs are recorded; a missing manager or supervisor stays empty and shows up in the integrity report.
 */
export async function recordNewPerson(db, { actor, ref, title, departmentName = null, reportsTo = null, internSupervisor = null }) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
    const existing = await tx.query("SELECT 1 FROM public.org_assignments WHERE person_ref = $1 AND effective_to IS NULL", [ref]);
    if (existing.rowCount) return { created: false };
    const department = departmentName
      // A function answers to its own name and to the older names records were stored under (legacy_keys).
      ? (await tx.query(
        `SELECT id FROM public.org_departments
         WHERE active AND (lower(name) = lower($1) OR EXISTS (SELECT 1 FROM unnest(legacy_keys) key WHERE lower(key) = lower($1)))
         ORDER BY (lower(name) = lower($1)) DESC, (parent_id IS NULL) DESC LIMIT 1`, [departmentName])).rows[0]?.id ?? null
      : null;
    const state = await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version");
    const after = { title, departmentId: department, reportsTo, internSupervisor };
    const change = await tx.query(
      `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, subject_refs, after, version_after)
       VALUES ('person.added',$1,$2,$3,$4::jsonb,$5) RETURNING id`,
      [actor.userId, actor.name, [ref], JSON.stringify(after), state.rows[0].version],
    );
    const changeId = change.rows[0].id;
    await tx.query("INSERT INTO public.org_assignments (person_ref, title, department_id, change_id) VALUES ($1,$2,$3,$4)", [ref, title || "Title not set", department, changeId]);
    if (reportsTo && reportsTo !== ref) {
      await tx.query("INSERT INTO public.org_relationships (type, subject_ref, manager_ref, change_id) VALUES ('reports_to',$1,$2,$3) ON CONFLICT DO NOTHING", [ref, reportsTo, changeId]);
    }
    if (internSupervisor && internSupervisor !== ref) {
      await tx.query("INSERT INTO public.org_relationships (type, subject_ref, manager_ref, change_id) VALUES ('intern_supervisor',$1,$2,$3) ON CONFLICT DO NOTHING", [ref, internSupervisor, changeId]);
    }
    return { created: true, changeId };
  });
}

/** Current organisational responsibilities that would be orphaned if this person left. */
export async function currentResponsibilities(db, ref) {
  const [reports, leads] = await Promise.all([
    db.query("SELECT type, subject_ref FROM public.org_relationships WHERE manager_ref = $1 AND effective_to IS NULL", [ref]),
    db.query("SELECT department_id FROM public.org_department_leads WHERE person_ref = $1 AND effective_to IS NULL", [ref]),
  ]);
  return {
    directReports: reports.rows.filter((row) => row.type === "reports_to").map((row) => row.subject_ref),
    supervisedInterns: reports.rows.filter((row) => row.type === "intern_supervisor").map((row) => row.subject_ref),
    functionalReports: reports.rows.filter((row) => row.type === "functional_lead").map((row) => row.subject_ref),
    departmentsLed: leads.rows.map((row) => row.department_id),
  };
}

/** Closes (never deletes) everything current for a person who has been removed from the directory. */
export async function endPersonOrg(db, { actor, ref }) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
    const responsibilities = await currentResponsibilities(tx, ref);
    if (responsibilities.directReports.length || responsibilities.supervisedInterns.length || responsibilities.functionalReports.length || responsibilities.departmentsLed.length) {
      throw new OrgError("Reassign this person's reports, interns and leadership before removing them.", 409, "has_responsibilities");
    }
    const state = await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version");
    const before = (await tx.query("SELECT title, department_id FROM public.org_assignments WHERE person_ref = $1 AND effective_to IS NULL", [ref])).rows[0] || {};
    await tx.query(
      `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, subject_refs, before, version_after) VALUES ('person.removed',$1,$2,$3,$4::jsonb,$5)`,
      [actor.userId, actor.name, [ref], JSON.stringify(before), state.rows[0].version],
    );
    await tx.query("UPDATE public.org_assignments SET effective_to = now() WHERE person_ref = $1 AND effective_to IS NULL", [ref]);
    await tx.query("UPDATE public.org_relationships SET effective_to = now() WHERE subject_ref = $1 AND effective_to IS NULL", [ref]);
    return { ended: true };
  });
}
