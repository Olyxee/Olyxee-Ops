import { ORG_CAPABILITIES } from "./schema.mjs";
import { OrgError, normalizeChange, planChange } from "./plan.mjs";
import { buildChart } from "./chart.mjs";

// ---- database adapters (a pg Pool in production, PGlite in tests) ----
export const fromPgPool = (pool) => ({
  query: (sql, params) => pool.query(sql, params),
  async transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work({ query: (sql, params) => client.query(sql, params) });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
      throw error;
    } finally {
      client.release();
    }
  },
});
// PGlite reports affected rows differently from pg; normalise so callers can rely on rowCount.
const withRowCount = async (promise) => {
  const result = await promise;
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
};
export const fromPglite = (pglite) => ({
  query: (sql, params) => withRowCount(pglite.query(sql, params)),
  transaction: (work) => pglite.transaction((tx) => work({ query: (sql, params) => withRowCount(tx.query(sql, params)) })),
});

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

// ---- capabilities ----
export async function getUserCapabilities(db, userId) {
  const { rows } = await db.query(
    "SELECT capability, scope_department_id FROM public.org_capabilities WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return rows.map((row) => ({ capability: row.capability, scopeDepartmentId: row.scope_department_id }));
}
export const holds = (capabilities, capability, scopeDepartmentId = null) =>
  capabilities.some((item) => item.capability === capability && (item.scopeDepartmentId === null || item.scopeDepartmentId === scopeDepartmentId));

async function activeHolders(tx, capability) {
  const { rows } = await tx.query(`
    SELECT count(DISTINCT c.user_id)::int AS count
    FROM public.org_capabilities c JOIN public.ops_users u ON u.id = c.user_id
    WHERE c.capability = $1 AND c.revoked_at IS NULL AND u.active = true`, [capability]);
  return rows[0].count;
}

async function recordCapabilityChange(tx, { kind, actor, userId, capability, scopeDepartmentId, via }) {
  await tx.query(
    `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, subject_refs, after) VALUES ($1,$2,$3,'{}',$4::jsonb)`,
    [kind, actor?.userId ?? null, actor?.name || "Bootstrap", JSON.stringify({ userId, capability, scopeDepartmentId: scopeDepartmentId ?? null, via })],
  );
}

/** Grants a capability. A grantor needs org.delegate AND must hold the capability they hand out. */
export async function grantCapability(db, { actor, userId, capability, scopeDepartmentId = null, via = "delegation" }) {
  if (!ORG_CAPABILITIES.includes(capability)) throw new OrgError("Unknown capability.");
  return db.transaction(async (tx) => {
    if (via !== "bootstrap") {
      const mine = await getUserCapabilities(tx, actor.userId);
      if (!holds(mine, "org.delegate")) throw new OrgError("You are not authorised to delegate organisational capabilities.", 403, "forbidden");
      if (!holds(mine, capability)) throw new OrgError("You can only delegate capabilities you hold yourself.", 403, "escalation");
    }
    const user = await tx.query("SELECT id, active FROM public.ops_users WHERE id = $1", [userId]);
    if (!user.rows[0]?.active) throw new OrgError("That account is not available.", 404, "not_found");
    if (scopeDepartmentId) {
      const department = await tx.query("SELECT 1 FROM public.org_departments WHERE id = $1 AND active", [scopeDepartmentId]);
      if (!department.rowCount) throw new OrgError("Choose an active department.");
    }
    const inserted = await tx.query(
      `INSERT INTO public.org_capabilities (user_id, capability, scope_department_id, granted_by, granted_via)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
      [userId, capability, scopeDepartmentId, actor?.userId ?? null, via],
    );
    if (inserted.rowCount) await recordCapabilityChange(tx, { kind: "capability.grant", actor, userId, capability, scopeDepartmentId, via });
    return { granted: Boolean(inserted.rowCount) };
  });
}

export async function revokeCapability(db, { actor, userId, capability, scopeDepartmentId = null }) {
  return db.transaction(async (tx) => {
    const mine = await getUserCapabilities(tx, actor.userId);
    if (!holds(mine, "org.delegate")) throw new OrgError("You are not authorised to delegate organisational capabilities.", 403, "forbidden");
    if (["org.approve", "org.delegate"].includes(capability) && (await activeHolders(tx, capability)) <= 1) {
      const target = await tx.query(
        "SELECT 1 FROM public.org_capabilities WHERE user_id = $1 AND capability = $2 AND revoked_at IS NULL", [userId, capability]);
      if (target.rowCount) throw new OrgError(`This is the last holder of ${capability}. Grant it to someone else first.`, 409, "last_holder");
    }
    const revoked = await tx.query(
      `UPDATE public.org_capabilities SET revoked_at = now(), revoked_by = $4
       WHERE user_id = $1 AND capability = $2 AND coalesce(scope_department_id::text,'') = coalesce($3::text,'') AND revoked_at IS NULL RETURNING id`,
      [userId, capability, scopeDepartmentId, actor.userId],
    );
    if (!revoked.rowCount) throw new OrgError("That capability is not currently granted.", 404, "not_found");
    await recordCapabilityChange(tx, { kind: "capability.revoke", actor, userId, capability, scopeDepartmentId, via: "delegation" });
    return { revoked: true };
  });
}

export async function listCapabilities(db) {
  const { rows } = await db.query(`
    SELECT c.id, c.user_id, u.display_name, u.email, c.capability, c.scope_department_id, c.granted_at, g.display_name AS granted_by_name
    FROM public.org_capabilities c
    JOIN public.ops_users u ON u.id = c.user_id
    LEFT JOIN public.ops_users g ON g.id = c.granted_by
    WHERE c.revoked_at IS NULL ORDER BY u.display_name, c.capability`);
  return rows.map((row) => ({ ...row, granted_at: iso(row.granted_at) }));
}

// ---- snapshots ----
export const getVersion = async (db) => Number((await db.query("SELECT version FROM public.org_state WHERE id = 1")).rows[0]?.version ?? 0);

async function readTables(db, asOf) {
  const when = asOf ? new Date(asOf).toISOString() : null;
  const live = (alias) => (when
    ? `${alias}.effective_from <= $1 AND (${alias}.effective_to IS NULL OR ${alias}.effective_to > $1)`
    : `${alias}.effective_to IS NULL`);
  const params = when ? [when] : [];
  const [departments, assignments, relationships, leads, links, exclusions] = await Promise.all([
    db.query("SELECT id, name, active, kind, description, legacy_keys, parent_id, sort_order FROM public.org_departments ORDER BY sort_order, name"),
    db.query(`SELECT a.person_ref, a.title, a.department_id, a.position_id FROM public.org_assignments a WHERE ${live("a")}`, params),
    db.query(`SELECT r.type, r.subject_ref, r.manager_ref FROM public.org_relationships r WHERE ${live("r")}`, params),
    db.query(`SELECT l.department_id, l.person_ref FROM public.org_department_leads l WHERE ${live("l")}`, params),
    db.query("SELECT superseded_ref, canonical_ref FROM public.org_identity_links"),
    db.query("SELECT person_ref, reason FROM public.org_chart_exclusions"),
  ]);
  return {
    departments: departments.rows,
    assignments: assignments.rows.map((row) => ({ personRef: row.person_ref, title: row.title, departmentId: row.department_id, positionId: row.position_id })),
    relationships: relationships.rows.map((row) => ({ type: row.type, subjectRef: row.subject_ref, managerRef: row.manager_ref })),
    departmentLeads: leads.rows.map((row) => ({ departmentId: row.department_id, personRef: row.person_ref })),
    identityLinks: links.rows.map((row) => ({ supersededRef: row.superseded_ref, canonicalRef: row.canonical_ref })),
    exclusions: exclusions.rows.map((row) => ({ personRef: row.person_ref, reason: row.reason })),
  };
}

/** People as recorded, with the Ops-owned employment classification applied on top. */
export async function loadClassifiedPeople(db, loadPeople) {
  const [people, rows] = await Promise.all([loadPeople(), db.query("SELECT person_ref, employment_type FROM public.org_person_classification")]);
  const override = new Map(rows.rows.map((row) => [row.person_ref, row.employment_type]));
  return people.map((person) => (override.has(person.ref) ? { ...person, employmentType: override.get(person.ref) } : person));
}

export async function getChart(db, loadPeople, { asOf = null, includeAlumni = false } = {}) {
  const [people, tables, version] = await Promise.all([loadClassifiedPeople(db, loadPeople), readTables(db, asOf), getVersion(db)]);
  return { ...buildChart({ people, ...tables }, { includeAlumni }), version, asOf: asOf ? new Date(asOf).toISOString() : null };
}

async function loadSnapshot(tx, loadPeople) {
  const [people, tables] = await Promise.all([loadClassifiedPeople(tx, loadPeople), readTables(tx, null)]);
  const canonical = (ref) => tables.identityLinks.find((link) => link.supersededRef === ref)?.canonicalRef || ref;
  const snapshot = {
    people: new Map(people.filter((person) => !tables.identityLinks.some((link) => link.supersededRef === person.ref)).map((person) => [person.ref, person])),
    departments: new Map(tables.departments.map((department) => [department.id, department])),
    // A merged duplicate must never override the person's own record: apply superseded rows first.
    assignments: new Map([...tables.assignments].sort((a, b) => Number(canonical(b.personRef) !== b.personRef) - Number(canonical(a.personRef) !== a.personRef)).map((item) => [canonical(item.personRef), item])),
    reportsTo: new Map(tables.relationships.filter((item) => item.type === "reports_to").map((item) => [canonical(item.subjectRef), canonical(item.managerRef)])),
    supervisors: new Map(tables.relationships.filter((item) => item.type === "intern_supervisor").map((item) => [canonical(item.subjectRef), canonical(item.managerRef)])),
    functional: tables.relationships.filter((item) => item.type === "functional_lead"),
    departmentLeads: new Map(tables.departmentLeads.map((item) => [item.departmentId, canonical(item.personRef)])),
  };
  return snapshot;
}

export async function previewChange(db, loadPeople, input) {
  const change = normalizeChange(input);
  const snapshot = await loadSnapshot(db, loadPeople);
  const plan = planChange(snapshot, change);
  return { summary: plan.summary, before: plan.before, after: plan.after, affectedRefs: plan.affectedRefs, version: await getVersion(db) };
}

// ---- applying changes (single serialised transaction) ----
async function executePlan(tx, { plan, change, actor, proposalId = null, kind }) {
  const state = await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version");
  const version = Number(state.rows[0].version);
  const recorded = await tx.query(
    `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, proposal_id, reason, subject_refs, before, after, version_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING id, created_at`,
    [kind, actor.userId, actor.name, proposalId, change.reason, plan.affectedRefs, JSON.stringify(plan.before), JSON.stringify(plan.after), version],
  );
  const changeId = recorded.rows[0].id;
  const { ops } = plan;
  if (ops.classification) {
    await tx.query(
      `INSERT INTO public.org_person_classification (person_ref, employment_type, change_id) VALUES ($1,$2,$3)
       ON CONFLICT (person_ref) DO UPDATE SET employment_type = EXCLUDED.employment_type, change_id = EXCLUDED.change_id, set_at = now()`,
      [plan.subjectRef, ops.classification.employmentType, changeId],
    );
  }
  if (ops.assignment) {
    await tx.query("UPDATE public.org_assignments SET effective_to = now() WHERE person_ref = $1 AND effective_to IS NULL", [plan.subjectRef]);
    await tx.query(
      `INSERT INTO public.org_assignments (person_ref, title, department_id, position_id, change_id) VALUES ($1,$2,$3,$4,$5)`,
      [plan.subjectRef, ops.assignment.title, ops.assignment.departmentId, ops.assignment.positionId, changeId],
    );
  }
  for (const item of ops.closeRelationships) {
    await tx.query(
      `UPDATE public.org_relationships SET effective_to = now() WHERE type = $1 AND subject_ref = $2 AND manager_ref = $3 AND effective_to IS NULL`,
      [item.type, item.subjectRef, item.managerRef],
    );
  }
  for (const item of ops.openRelationships) {
    await tx.query(
      `INSERT INTO public.org_relationships (type, subject_ref, manager_ref, change_id) VALUES ($1,$2,$3,$4)`,
      [item.type, item.subjectRef, item.managerRef, changeId],
    );
  }
  for (const lead of ops.closeLeads) {
    await tx.query(
      `UPDATE public.org_department_leads SET effective_to = now() WHERE department_id = $1 AND person_ref = $2 AND effective_to IS NULL`,
      [lead.departmentId, lead.personRef],
    );
  }
  for (const lead of ops.openLeads) {
    await tx.query(
      `INSERT INTO public.org_department_leads (department_id, person_ref, change_id) VALUES ($1,$2,$3)`,
      [lead.departmentId, lead.personRef, changeId],
    );
  }
  return { changeId, version, createdAt: iso(recorded.rows[0].created_at) };
}

const conflictFromDb = (error) => {
  if (error?.code === "23505") return new OrgError("The organisation changed while you were working. Review it and try again.", 409, "conflict");
  return error;
};

/** expectedVersion is mandatory: it is the org version the approver reviewed. */
export async function applyChange(db, loadPeople, { actor, input, expectedVersion, proposalId = null, kind = "role.change" }) {
  if (!Number.isInteger(expectedVersion)) throw new OrgError("expectedVersion is required.", 400, "version_required");
  const change = normalizeChange(input);
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
      if (Number(locked.rows[0].version) !== expectedVersion) {
        throw new OrgError("The organisation changed since you opened this. Reload and review again.", 409, "stale");
      }
      const plan = planChange(await loadSnapshot(tx, loadPeople), change);
      const result = await executePlan(tx, { plan, change, actor, proposalId, kind });
      return { ...result, summary: plan.summary, before: plan.before, after: plan.after, affectedRefs: plan.affectedRefs, subjectRef: plan.subjectRef };
    });
  } catch (error) {
    throw conflictFromDb(error);
  }
}

// ---- proposals ----
export async function createProposal(db, loadPeople, { actor, input }) {
  const change = normalizeChange(input);
  const snapshot = await loadSnapshot(db, loadPeople);
  const plan = planChange(snapshot, change); // reject proposals that could never be applied
  const version = await getVersion(db);
  const { rows } = await db.query(
    `INSERT INTO public.org_proposals (proposed_by, proposed_by_name, payload, base_version, reason) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`,
    [actor.userId, actor.name, JSON.stringify(change), version, change.reason],
  );
  return { id: rows[0].id, summary: plan.summary };
}

export async function listProposals(db, { status = null, proposedBy = null } = {}) {
  const { rows } = await db.query(
    `SELECT id, proposed_by, proposed_by_name, payload, base_version, reason, status, decided_by, decided_at, decision_note, applied_change_id, created_at
     FROM public.org_proposals WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR proposed_by = $2) ORDER BY created_at DESC LIMIT 200`,
    [status, proposedBy],
  );
  return rows.map((row) => ({ ...row, decided_at: iso(row.decided_at), created_at: iso(row.created_at) }));
}

export async function decideProposal(db, loadPeople, { actor, proposalId, decision, note = "", acknowledgeChanges = false }) {
  if (!["approve", "reject"].includes(decision)) throw new OrgError("Decision must be approve or reject.");
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
      const proposal = (await tx.query("SELECT * FROM public.org_proposals WHERE id = $1 FOR UPDATE", [proposalId])).rows[0];
      if (!proposal) throw new OrgError("Proposal not found.", 404, "not_found");
      if (proposal.status !== "pending") throw new OrgError("This proposal has already been decided.", 409, "decided");
      const cleanNote = String(note || "").trim().slice(0, 500);
      if (decision === "reject") {
        await tx.query("UPDATE public.org_proposals SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1", [proposalId, actor.userId, cleanNote]);
        return { status: "rejected" };
      }
      const version = Number(locked.rows[0].version);
      if (version !== Number(proposal.base_version) && !acknowledgeChanges) {
        throw new OrgError("The organisation has changed since this was proposed. Review it again and confirm.", 409, "stale");
      }
      const change = normalizeChange(proposal.payload);
      const plan = planChange(await loadSnapshot(tx, loadPeople), change);
      const result = await executePlan(tx, { plan, change, actor, proposalId, kind: "role.change" });
      await tx.query(
        "UPDATE public.org_proposals SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3, applied_change_id=$4 WHERE id=$1",
        [proposalId, actor.userId, cleanNote, result.changeId],
      );
      return { status: "approved", ...result, summary: plan.summary, affectedRefs: plan.affectedRefs, subjectRef: plan.subjectRef };
    });
  } catch (error) {
    throw conflictFromDb(error);
  }
}

export async function withdrawProposal(db, { actor, proposalId }) {
  const { rowCount } = await db.query(
    "UPDATE public.org_proposals SET status='withdrawn', decided_by=$2, decided_at=now() WHERE id=$1 AND proposed_by=$2 AND status='pending'",
    [proposalId, actor.userId],
  );
  if (!rowCount) throw new OrgError("Only your own pending proposals can be withdrawn.", 404, "not_found");
  return { status: "withdrawn" };
}

// ---- reference data and history ----
export async function listHistory(db, { personRef = null, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT id, kind, actor_name, reason, subject_refs, before, after, proposal_id, version_after, created_at
     FROM public.org_changes WHERE ($1::text IS NULL OR $1 = ANY(subject_refs)) ORDER BY created_at DESC, id LIMIT $2`,
    [personRef, Math.min(Math.max(Number(limit) || 100, 1), 500)],
  );
  return rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
}

export async function listPositions(db) {
  return (await db.query("SELECT id, title FROM public.org_positions WHERE active ORDER BY title")).rows;
}
export async function createPosition(db, { title }) {
  const clean = String(title || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) throw new OrgError("A position title is required.");
  const { rows } = await db.query(
    "INSERT INTO public.org_positions (title) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, title", [clean]);
  if (!rows[0]) throw new OrgError("That position already exists.", 409, "exists");
  return rows[0];
}
