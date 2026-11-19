import { recordNewPerson } from "./lifecycle.mjs";
import { readLegacyRelations } from "./people-source.mjs";

// People added outside Ops (for example in the People directory itself) have no organisation record, so they would never
// reach the chart. This gives each of them a first record from what the directory explicitly says, and nothing else:
//  - a person with no organisation record at all gets one (title, function, and their supervisor or manager);
//  - an active intern who has never had a supervisor recorded gets the one named in the directory.
// Anything already recorded, ended on purpose or excluded is left alone. Supervisors are matched by account id, then email,
// then exact name; an ambiguous or missing match leaves the person on the "needs a supervisor" list.

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
const SYSTEM = { userId: null, name: "Directory sync" };

export async function syncNewPeople(db, peoplePool, { dryRun = false } = {}) {
  const { accounts, interns } = await readLegacyRelations(peoplePool);
  const known = new Set((await db.query("SELECT DISTINCT person_ref FROM public.org_assignments")).rows.map((row) => row.person_ref));
  const everSupervised = new Set((await db.query("SELECT DISTINCT subject_ref FROM public.org_relationships WHERE type IN ('intern_supervisor','reports_to')")).rows.map((row) => row.subject_ref));

  const active = accounts.filter((account) => account.active);
  const uniqueBy = (key, value) => {
    const matches = active.filter((account) => value && clean(account[key]) === value);
    return matches.length === 1 ? matches[0] : null;
  };
  const supervisorFor = (intern) => {
    if (intern.supervisor_account_id) return active.find((account) => Number(account.id) === Number(intern.supervisor_account_id)) || null;
    return uniqueBy("email", clean(intern.supervisor_email)) || uniqueBy("display_name", clean(intern.supervisor_name));
  };

  const added = [];
  for (const account of accounts) {
    const ref = `account-${account.id}`;
    if (known.has(ref) || !account.active) continue;
    const manager = accounts.find((item) => Number(item.id) === Number(account.reports_to_account_id));
    if (dryRun) { added.push(ref); continue; }
    await recordNewPerson(db, { actor: SYSTEM, ref, title: null, departmentName: account.department || null, reportsTo: manager ? `account-${manager.id}` : null });
    added.push(ref);
  }
  for (const intern of interns) {
    if (clean(intern.employment_status) !== "active") continue;
    const ref = `intern-${intern.id}`;
    const supervisor = supervisorFor(intern);
    const supervisorRef = supervisor ? `account-${supervisor.id}` : null;
    if (dryRun && (!known.has(ref) || (supervisorRef && !everSupervised.has(ref)))) { added.push(`${ref} -> ${supervisorRef}`); continue; }
    if (!known.has(ref)) {
      const department = String(intern.department || "").trim();
      await recordNewPerson(db, {
        actor: SYSTEM, ref, title: String(intern.position || "").trim() || "Intern",
        departmentName: department && clean(department) !== "unassigned" ? department : null,
        internSupervisor: supervisorRef,
      });
      added.push(ref);
    } else if (supervisorRef && !everSupervised.has(ref)) {
      await db.transaction(async (tx) => {
        await tx.query("SELECT version FROM public.org_state WHERE id = 1 FOR UPDATE");
        const current = await tx.query("SELECT 1 FROM public.org_relationships WHERE subject_ref = $1 AND type IN ('intern_supervisor','reports_to')", [ref]);
        if (current.rowCount) return;
        const state = await tx.query("UPDATE public.org_state SET version = version + 1, updated_at = now() WHERE id = 1 RETURNING version");
        const change = await tx.query(
          `INSERT INTO public.org_changes (kind, actor_user_id, actor_name, reason, subject_refs, after, version_after)
           VALUES ('person.synced', NULL, $1, 'Supervisor taken from the People directory', $2, $3::jsonb, $4) RETURNING id`,
          [SYSTEM.name, [ref], JSON.stringify({ internSupervisor: supervisorRef }), state.rows[0].version]);
        await tx.query("INSERT INTO public.org_relationships (type, subject_ref, manager_ref, change_id) VALUES ('intern_supervisor',$1,$2,$3) ON CONFLICT DO NOTHING", [ref, supervisorRef, change.rows[0].id]);
      });
      added.push(ref);
    }
  }
  return { added };
}

/** Runs the sync at most once per interval and never lets a failure reach the caller. */
export function createDirectorySync(db, peoplePool, { intervalMs = 30000 } = {}) {
  let last = 0;
  let running = null;
  return async () => {
    if (running) return running;
    if (Date.now() - last < intervalMs) return { added: [] };
    last = Date.now();
    running = syncNewPeople(db, peoplePool)
      .catch((error) => { console.error("Directory sync failed:", error instanceof Error ? error.message : "Unknown error"); return { added: [] }; })
      .finally(() => { running = null; });
    return running;
  };
}
