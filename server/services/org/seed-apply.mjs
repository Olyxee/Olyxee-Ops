// Writes a seed plan into the Ops database. Idempotent: existing current rows are never touched,
// so running it twice (or after people have started using the Change Role flow) changes nothing.

export async function applySeed(db, plan, { ops = null } = {}) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
    const counts = { departments: 0, assignments: 0, relationships: 0, links: 0, exclusions: 0 };

    const departmentIds = new Map();
    for (const name of plan.departments) {
      const existing = await tx.query("SELECT id FROM public.org_departments WHERE lower(name) = lower($1) AND active", [name]);
      if (existing.rows[0]) { departmentIds.set(name, existing.rows[0].id); continue; }
      const created = await tx.query("INSERT INTO public.org_departments (name) VALUES ($1) RETURNING id", [name]);
      departmentIds.set(name, created.rows[0].id);
      counts.departments += 1;
    }

    const change = await tx.query(
      `INSERT INTO public.org_changes (kind, actor_name, reason, after) VALUES ('migration.seed','Migration','Seeded from existing staff records',$1::jsonb) RETURNING id`,
      [JSON.stringify({ assignments: plan.assignments.length, relationships: plan.relationships.length })],
    );
    const changeId = change.rows[0].id;

    for (const item of plan.assignments) {
      const has = await tx.query("SELECT 1 FROM public.org_assignments WHERE person_ref = $1 AND effective_to IS NULL", [item.personRef]);
      if (has.rowCount) continue;
      await tx.query(
        `INSERT INTO public.org_assignments (person_ref, title, department_id, change_id) VALUES ($1,$2,$3,$4)`,
        [item.personRef, item.title, item.department ? departmentIds.get(item.department) ?? null : null, changeId],
      );
      counts.assignments += 1;
    }
    for (const item of plan.relationships) {
      const has = await tx.query(
        `SELECT 1 FROM public.org_relationships WHERE type = $1 AND subject_ref = $2 AND effective_to IS NULL
           AND ($1 = 'functional_lead' AND manager_ref = $3 OR $1 <> 'functional_lead')`,
        [item.type, item.subjectRef, item.managerRef],
      );
      if (has.rowCount) continue;
      await tx.query(
        `INSERT INTO public.org_relationships (type, subject_ref, manager_ref, change_id) VALUES ($1,$2,$3,$4)`,
        [item.type, item.subjectRef, item.managerRef, changeId],
      );
      counts.relationships += 1;
    }
    for (const link of plan.links) {
      const done = await tx.query(
        `INSERT INTO public.org_identity_links (superseded_ref, canonical_ref, reason, confirmed_by) VALUES ($1,$2,'Same person recorded as intern and employee',$3) ON CONFLICT DO NOTHING RETURNING 1`,
        [link.supersededRef, link.canonicalRef, ops?.confirmedBy ?? null],
      );
      counts.links += done.rowCount;
    }
    for (const item of plan.exclusions) {
      const done = await tx.query(
        `INSERT INTO public.org_chart_exclusions (person_ref, reason, set_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`,
        [item.personRef, item.reason, ops?.confirmedBy ?? null],
      );
      counts.exclusions += done.rowCount;
    }
    if (counts.assignments + counts.relationships + counts.links + counts.exclusions + counts.departments > 0) {
      await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1");
    }
    return counts;
  });
}
