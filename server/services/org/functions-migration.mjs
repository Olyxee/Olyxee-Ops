// The apply step of the functional-model migration (see scripts/configure-functions.mjs). It lives here so it can be
// tested against a database shaped like production. Each step goes through the audited, version-checked code the app
// uses; repeating it changes nothing (a no_change result is expected and ignored).
import { applyChange, getVersion, loadClassifiedPeople } from "./store.mjs";
import { createFunction, updateFunction } from "./structure.mjs";

const REASON = "Adopt the functional organisation model";
const ignoreNoChange = (error) => { if (error?.code !== "no_change") throw error; };

export async function applyFunctionsMigration(db, loadPeople, actor, config, { log = () => {} } = {}) {
  const { functions, specialisations, parent, placement } = config;
  const version = () => getVersion(db);
  const people = await loadClassifiedPeople(db, loadPeople);
  const byEmail = (email) => people.find((person) => String(person.email || "").toLowerCase() === email.toLowerCase());
  const findUnit = async (...names) => (await db.query("SELECT id FROM public.org_departments WHERE active AND lower(name) = ANY($1)", [names.map((name) => name.toLowerCase())])).rows[0];
  const unitIds = {};

  for (const fn of functions) {
    const found = await findUnit(fn.from, fn.name);
    if (!found) throw new Error(`No department called "${fn.from}" or "${fn.name}".`);
    await updateFunction(db, { actor, expectedVersion: await version(), id: found.id, name: fn.name, description: fn.description, legacyKeys: fn.legacy, sortOrder: fn.order, parentId: null, reason: REASON }).catch(ignoreNoChange);
    unitIds[fn.name] = found.id;
  }
  for (const spec of specialisations) {
    const found = await findUnit(spec.from || spec.name, spec.name);
    if (found) {
      await updateFunction(db, { actor, expectedVersion: await version(), id: found.id, name: spec.name, description: spec.description, legacyKeys: spec.legacy, sortOrder: spec.order, parentId: unitIds[spec.parent || parent], reason: REASON }).catch(ignoreNoChange);
      unitIds[spec.name] = found.id;
    } else {
      const created = await createFunction(db, { actor, expectedVersion: await version(), name: spec.name, parentId: unitIds[spec.parent || parent], description: spec.description, legacyKeys: spec.legacy, reason: REASON });
      await db.query("UPDATE public.org_departments SET sort_order = $2 WHERE id = $1", [created.id, spec.order]);
      unitIds[spec.name] = created.id;
    }
  }
  for (const [email, unit] of Object.entries(placement)) {
    const person = byEmail(email);
    if (!person) throw new Error(`No person with email ${email}.`);
    await applyChange(db, loadPeople, { actor, expectedVersion: await version(), input: { subjectRef: person.ref, departmentId: unitIds[unit], reason: REASON } }).catch(ignoreNoChange);
  }
  for (const unit of [...functions, ...specialisations]) {
    const person = byEmail(unit.leader);
    if (!person) throw new Error(`No person with email ${unit.leader}.`);
    await applyChange(db, loadPeople, { actor, expectedVersion: await version(), input: { subjectRef: person.ref, leadOfAdd: [unitIds[unit.name]], reason: REASON } }).catch(ignoreNoChange);
  }
  return unitIds;
}
