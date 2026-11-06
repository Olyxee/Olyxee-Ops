import { OrgError } from "./plan.mjs";

// Functions (formerly departments), specialisations inside them, and cross-functional initiatives.
// Everything is data: nothing here names a function, a person or a product. Each write is one
// serialised transaction that checks the version the approver reviewed, bumps it, and records an
// immutable org_changes entry. Authorisation (org.approve) is enforced by the routes.

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const cleanKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : []).map((key) => clean(key, 120)).filter(Boolean))].slice(0, 12);

async function inChange(db, { actor, expectedVersion, kind, reason = "" }, work) {
  if (!Number.isInteger(expectedVersion)) throw new OrgError("expectedVersion is required.", 400, "version_required");
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
      if (Number(locked.rows[0].version) !== expectedVersion) {
        throw new OrgError("The organisation changed while you were working. Review it and try again.", 409, "stale");
      }
      const state = await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version");
      const version = Number(state.rows[0].version);
      const record = { before: {}, after: {}, subjectRefs: [] };
      const result = await work(tx, record);
      const inserted = await tx.query(
        `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, reason, subject_refs, before, after, version_after)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) RETURNING id`,
        [kind, actor.userId, actor.name, clean(reason, 500), record.subjectRefs, JSON.stringify(record.before), JSON.stringify(record.after), version],
      );
      return { ...result, version, changeId: inserted.rows[0].id };
    });
  } catch (error) {
    if (error?.code === "23505") throw new OrgError("That name is already in use.", 409, "exists");
    throw error;
  }
}

const loadUnit = async (tx, id) => (await tx.query("SELECT * FROM public.org_departments WHERE id = $1 FOR UPDATE", [id])).rows[0];

async function assertLegacyKeysFree(tx, keys, exceptId = null) {
  if (!keys.length) return;
  const clash = await tx.query(
    "SELECT name FROM public.org_departments WHERE active AND id IS DISTINCT FROM $2 AND legacy_keys && $1::text[] LIMIT 1", [keys, exceptId]);
  if (clash.rows[0]) throw new OrgError(`Another unit already answers to one of those legacy names (${clash.rows[0].name}).`, 409, "legacy_key");
}

async function assertValidParent(tx, parentId, selfId = null) {
  const parent = await loadUnit(tx, parentId);
  if (!parent || !parent.active) throw new OrgError("Choose an active function to place this under.", 400, "parent");
  if (parent.kind !== "function") throw new OrgError("A specialisation can only sit directly inside a function.", 409, "depth");
  if (selfId && parent.id === selfId) throw new OrgError("A unit cannot sit inside itself.", 409, "cycle");
  return parent;
}

/** Creates a function (no parentId) or a specialisation inside a function (parentId). */
export async function createFunction(db, { actor, expectedVersion, name, parentId = null, description = "", legacyKeys = [], reason = "" }) {
  const cleanName = clean(name, 80);
  if (cleanName.length < 2) throw new OrgError("Give the function a name of at least two characters.");
  return inChange(db, { actor, expectedVersion, kind: parentId ? "specialisation.created" : "function.created", reason }, async (tx, record) => {
    if (parentId) await assertValidParent(tx, parentId);
    const keys = cleanKeys(legacyKeys);
    await assertLegacyKeysFree(tx, keys);
    const { rows } = await tx.query(
      `INSERT INTO public.org_departments (name, kind, parent_id, description, legacy_keys, sort_order)
       VALUES ($1,$2,$3,$4,$5, (SELECT coalesce(max(sort_order), 0) + 10 FROM public.org_departments)) RETURNING id`,
      [cleanName, parentId ? "specialisation" : "function", parentId, clean(description, 500), keys]);
    record.after = { id: rows[0].id, name: cleanName, kind: parentId ? "specialisation" : "function", parentId };
    return { id: rows[0].id };
  });
}

/**
 * Rename, move, describe or archive a unit. parentId: undefined = unchanged, null = make it a top-level function.
 * Renaming never touches legacy_keys, so records stored under the old name keep resolving to this unit.
 */
export async function updateFunction(db, { actor, expectedVersion, id, name, parentId, description, legacyKeys, active, sortOrder, reason = "" }) {
  return inChange(db, { actor, expectedVersion, kind: "function.updated", reason }, async (tx, record) => {
    const unit = await loadUnit(tx, id);
    if (!unit) throw new OrgError("That function could not be found.", 404, "not_found");
    const before = { name: unit.name, parentId: unit.parent_id, description: unit.description, legacyKeys: unit.legacy_keys, active: unit.active, sortOrder: unit.sort_order };
    const next = { ...before };
    if (name !== undefined) {
      next.name = clean(name, 80);
      if (next.name.length < 2) throw new OrgError("Give the function a name of at least two characters.");
    }
    if (description !== undefined) next.description = clean(description, 500);
    if (sortOrder !== undefined) next.sortOrder = Number.isInteger(sortOrder) ? sortOrder : before.sortOrder;
    if (legacyKeys !== undefined) { next.legacyKeys = cleanKeys(legacyKeys); await assertLegacyKeysFree(tx, next.legacyKeys, id); }
    if (parentId !== undefined && parentId !== unit.parent_id) {
      if (parentId !== null) {
        await assertValidParent(tx, parentId, id);
        const children = await tx.query("SELECT 1 FROM public.org_departments WHERE parent_id = $1 AND active LIMIT 1", [id]);
        if (children.rowCount) throw new OrgError("This function has specialisations of its own, so it cannot be placed inside another.", 409, "depth");
      }
      next.parentId = parentId;
    }
    if (active !== undefined && Boolean(active) !== unit.active) {
      if (!active) {
        const children = await tx.query("SELECT count(*)::int n FROM public.org_departments WHERE parent_id = $1 AND active", [id]);
        const people = await tx.query("SELECT count(*)::int n FROM public.org_assignments WHERE department_id = $1 AND effective_to IS NULL", [id]);
        if (children.rows[0].n) throw new OrgError(`Archive or move its ${children.rows[0].n} specialisation(s) first.`, 409, "in_use");
        if (people.rows[0].n) throw new OrgError(`${people.rows[0].n} ${people.rows[0].n === 1 ? "person is" : "people are"} still assigned here. Move them first.`, 409, "in_use");
        await tx.query("UPDATE public.org_department_leads SET effective_to = now() WHERE department_id = $1 AND effective_to IS NULL", [id]);
      }
      next.active = Boolean(active);
    }
    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]));
    if (!changed.length) throw new OrgError("Nothing would change.", 409, "no_change");
    const kind = next.parentId === null ? "function" : "specialisation";
    await tx.query(
      `UPDATE public.org_departments SET name=$2, parent_id=$3, kind=$4, description=$5, legacy_keys=$6, active=$7, sort_order=$8 WHERE id=$1`,
      [id, next.name, next.parentId, kind, next.description, next.legacyKeys, next.active, next.sortOrder]);
    record.before = Object.fromEntries(changed.map((key) => [key, before[key]]));
    record.after = Object.fromEntries(changed.map((key) => [key, next[key]]));
    return { id, changed };
  });
}

// ---- initiatives (products): cross-functional, exactly one accountable owner ----

async function requireOwner(loadPeople, ownerRef) {
  const people = await loadPeople();
  const owner = people.find((person) => person.ref === ownerRef);
  if (!owner) throw new OrgError("The accountable owner could not be found.", 404, "not_found");
  if (!owner.active) throw new OrgError("The accountable owner is not active.", 409, "inactive");
  if (owner.employmentType !== "Employee") throw new OrgError("The accountable owner must be an employee.", 409, "ineligible");
  return owner;
}

export async function createInitiative(db, loadPeople, { actor, expectedVersion, name, description = "", ownerRef, reason = "" }) {
  const cleanName = clean(name, 80);
  if (cleanName.length < 2) throw new OrgError("Give the initiative a name of at least two characters.");
  if (!ownerRef) throw new OrgError("Every initiative needs one accountable owner.", 400, "owner_required");
  await requireOwner(loadPeople, ownerRef);
  return inChange(db, { actor, expectedVersion, kind: "initiative.created", reason }, async (tx, record) => {
    const { rows } = await tx.query("INSERT INTO public.org_initiatives (name, description) VALUES ($1,$2) RETURNING id", [cleanName, clean(description, 500)]);
    await tx.query("INSERT INTO public.org_initiative_owners (initiative_id, owner_ref) VALUES ($1,$2)", [rows[0].id, ownerRef]);
    record.after = { id: rows[0].id, name: cleanName, ownerRef };
    record.subjectRefs = [ownerRef];
    return { id: rows[0].id };
  });
}

export async function updateInitiative(db, loadPeople, { actor, expectedVersion, id, name, description, ownerRef, active, reason = "" }) {
  if (ownerRef !== undefined) {
    if (!ownerRef) throw new OrgError("Every initiative needs one accountable owner.", 400, "owner_required");
    await requireOwner(loadPeople, ownerRef);
  }
  return inChange(db, { actor, expectedVersion, kind: "initiative.updated", reason }, async (tx, record) => {
    const row = (await tx.query("SELECT * FROM public.org_initiatives WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new OrgError("That initiative could not be found.", 404, "not_found");
    const owner = (await tx.query("SELECT owner_ref FROM public.org_initiative_owners WHERE initiative_id = $1 AND effective_to IS NULL", [id])).rows[0]?.owner_ref ?? null;
    const before = { name: row.name, description: row.description, active: row.active, ownerRef: owner };
    const next = { ...before };
    if (name !== undefined) { next.name = clean(name, 80); if (next.name.length < 2) throw new OrgError("Give the initiative a name of at least two characters."); }
    if (description !== undefined) next.description = clean(description, 500);
    if (active !== undefined) next.active = Boolean(active);
    if (ownerRef !== undefined) next.ownerRef = ownerRef;
    const changed = Object.keys(next).filter((key) => next[key] !== before[key]);
    if (!changed.length) throw new OrgError("Nothing would change.", 409, "no_change");
    await tx.query("UPDATE public.org_initiatives SET name=$2, description=$3, active=$4 WHERE id=$1", [id, next.name, next.description, next.active]);
    if (changed.includes("ownerRef")) {
      await tx.query("UPDATE public.org_initiative_owners SET effective_to = now() WHERE initiative_id = $1 AND effective_to IS NULL", [id]);
      await tx.query("INSERT INTO public.org_initiative_owners (initiative_id, owner_ref) VALUES ($1,$2)", [id, next.ownerRef]);
    }
    record.before = Object.fromEntries(changed.map((key) => [key, before[key]]));
    record.after = Object.fromEntries(changed.map((key) => [key, next[key]]));
    record.subjectRefs = [...new Set([before.ownerRef, next.ownerRef].filter(Boolean))];
    return { id, changed };
  });
}

export async function listInitiatives(db, { includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT i.id, i.name, i.description, i.active, o.owner_ref, o.effective_from AS owner_since
     FROM public.org_initiatives i
     LEFT JOIN public.org_initiative_owners o ON o.initiative_id = i.id AND o.effective_to IS NULL
     WHERE ($1 OR i.active) ORDER BY i.name`, [includeInactive]);
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, active: row.active, ownerRef: row.owner_ref, ownerSince: row.owner_since ? new Date(row.owner_since).toISOString() : null }));
}
