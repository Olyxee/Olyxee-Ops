// Passes every weekly objective to one owner (the VP who oversees the teams) while remembering which team lead
// owned each one before, so the new owner can see which team still has what to do.
//
//   node --env-file=.env scripts/pass-objectives.mjs            dry run: shows exactly what would change
//   node --env-file=.env scripts/pass-objectives.mjs --apply    performs it (backup first, then read back)
//
// Only managerId changes, plus teamLeadId (the previous owner) being recorded. Titles, status, priority, dates,
// resources and everything else stay as they are. Repeating it changes nothing. Both databases are used read-only
// except for the single 'objectives' row in the Ops database, updated inside one transaction.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectOps, connectPeople } from "../server/services/org/connect.mjs";
import { createPeopleLoader } from "../server/services/org/people-source.mjs";
import { handOffObjectives } from "../shared/objective-handoff.mjs";

const APPLY = process.argv.includes("--apply");
const NEW_OWNER_EMAIL = "alisha.fatima@olyxee.com";
const ACTOR_EMAIL = "scofield@olyxee.com";

const ops = connectOps();
const peoplePool = connectPeople();
const people = await createPeopleLoader(peoplePool)();
const owner = people.find((person) => String(person.email || "").toLowerCase() === NEW_OWNER_EMAIL);
const nameOf = (ref) => people.find((person) => person.ref === ref)?.name || ref;
if (!owner || !owner.active) throw new Error(`No active person with email ${NEW_OWNER_EMAIL}.`);
const actor = (await ops.query("SELECT id FROM public.ops_users WHERE lower(email) = $1 AND active", [ACTOR_EMAIL])).rows[0];
if (!actor) throw new Error(`No active Ops account for ${ACTOR_EMAIL}.`);

const client = await ops.connect();
try {
  await client.query("BEGIN");
  const row = (await client.query("SELECT state_value FROM public.workspace_state WHERE state_key = 'objectives' FOR UPDATE")).rows[0];
  const objectives = Array.isArray(row?.state_value) ? row.state_value : [];
  const { objectives: next, changed } = handOffObjectives(objectives, owner.ref);

  console.log(APPLY ? "APPLYING" : "DRY RUN — nothing will be written", `\n${objectives.length} objectives, new owner: ${owner.name} (${owner.ref})`);
  for (const item of changed) console.log(` • “${item.title}” [${item.status}]  ${nameOf(item.from)} → ${owner.name}  (team: ${nameOf(item.from)})`);
  if (!changed.length) console.log(" • nothing to change");

  if (!APPLY || !changed.length) { await client.query("ROLLBACK"); }
  else {
    const backup = path.join(os.tmpdir(), `olyxee-objectives-before-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(objectives, null, 2));
    await client.query("UPDATE public.workspace_state SET state_value = $1::jsonb, updated_by = $2, updated_at = now() WHERE state_key = 'objectives'", [JSON.stringify(next), actor.id]);
    await client.query("COMMIT");
    console.log("\nBackup written:", backup);
    const verify = (await ops.query("SELECT state_value FROM public.workspace_state WHERE state_key = 'objectives'")).rows[0].state_value;
    console.log("VERIFIED FROM THE DATABASE");
    for (const objective of verify) console.log(` • “${objective.title}” owner: ${nameOf(objective.managerId)} | team: ${objective.teamLeadId ? nameOf(objective.teamLeadId) : "—"} | status: ${objective.status}`);
    const untouched = verify.every((objective, index) => ["title", "status", "priority", "dueDate", "description"].every((key) => objective[key] === objectives[index][key]));
    console.log("Titles, status, priority, dates and descriptions unchanged:", untouched);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await ops.end();
  await peoplePool.end();
}
