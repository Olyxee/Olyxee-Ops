import assert from "node:assert/strict";
import test from "node:test";
import { OrgError } from "./plan.mjs";
import {
  applyChange, createProposal, decideProposal, getChart, getUserCapabilities, getVersion, grantCapability,
  listHistory, previewChange, revokeCapability, holds, listProposals,
} from "./store.mjs";
import { loadPeople, makeDb } from "./fixtures.mjs";

async function world() {
  const w = await makeDb();
  const eng = await w.dept("Engineering");
  const ceo = await w.user("ceo", "Manager");
  const vp = await w.user("vp", "Manager");
  const tech = await w.user("tech", "Superadmin");
  const actor = (userId, name) => ({ userId, name });
  for (const c of ["org.view_all", "org.propose", "org.approve", "org.delegate", "intern.administer"]) {
    await grantCapability(w.db, { userId: ceo, capability: c, via: "bootstrap" });
  }
  const expectError = (promise, code) => assert.rejects(promise, (e) => e instanceof OrgError && e.code === code, `expected ${code}`);
  return { ...w, eng, ceo, vp, tech, actor, expectError, A: actor(ceo, "CEO") };
}
const apply = (w, input, extra = {}) => getVersion(w.db).then((expectedVersion) =>
  applyChange(w.db, loadPeople, { actor: w.A, input, expectedVersion, ...extra }));

test("a role change is saved with approver, timestamp, before/after and a new version", async () => {
  const w = await world();
  const v0 = await getVersion(w.db);
  const result = await apply(w, { subjectRef: "account-2", title: "VP of Engineering", departmentId: w.eng, reportsTo: "account-1", reason: "Promotion" });
  assert.equal(result.version, v0 + 1);
  const [entry] = await listHistory(w.db, { personRef: "account-2" });
  assert.equal(entry.actor_name, "CEO");
  assert.equal(entry.after.title, "VP of Engineering");
  assert.equal(entry.before.title, null);
  assert.ok(entry.created_at);
});

test("history is preserved when a person is demoted or transferred", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-3", title: "Team Lead", departmentId: w.eng });
  await apply(w, { subjectRef: "account-3", title: "Developer" });
  const rows = (await w.db.query("SELECT title, effective_to FROM public.org_assignments WHERE person_ref='account-3' ORDER BY effective_from, id")).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows[0].effective_to);            // old title closed, not deleted
  assert.equal(rows[1].effective_to, null);   // exactly one current
  assert.equal(rows.filter((r) => r.title === "Team Lead").length, 1);
});

test("history rows cannot be deleted or rewritten", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-3", title: "Team Lead" });
  await assert.rejects(w.db.query("DELETE FROM public.org_assignments"), /cannot be deleted/);
  await assert.rejects(w.db.query("UPDATE public.org_changes SET reason='x'"), /immutable/);
  await assert.rejects(w.db.query("UPDATE public.org_assignments SET title='Hacked'"), /Only effective_to|Closed/);
});

test("stale or missing expectedVersion is rejected; failed changes write nothing", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-3", title: "Lead" });
  await w.expectError(applyChange(w.db, loadPeople, { actor: w.A, input: { subjectRef: "account-4", title: "Dev" }, expectedVersion: 0 }), "stale");
  await w.expectError(applyChange(w.db, loadPeople, { actor: w.A, input: { subjectRef: "account-4", title: "Dev" } }), "version_required");
  const before = await getVersion(w.db);
  await w.expectError(apply(w, { subjectRef: "account-1", reportsTo: "account-1" }), "cycle");
  assert.equal(await getVersion(w.db), before);
  assert.equal((await w.db.query("SELECT count(*)::int c FROM public.org_assignments WHERE person_ref='account-4'")).rows[0].c, 0);
});

test("two concurrent edits from the same version: exactly one succeeds", async () => {
  const w = await world();
  const expectedVersion = await getVersion(w.db);
  const results = await Promise.allSettled([
    applyChange(w.db, loadPeople, { actor: w.A, input: { subjectRef: "account-3", title: "A" }, expectedVersion }),
    applyChange(w.db, loadPeople, { actor: w.A, input: { subjectRef: "account-4", title: "B" }, expectedVersion }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "stale");
});

test("circular hierarchies are rejected end to end", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-2", reportsTo: "account-1" });
  await apply(w, { subjectRef: "account-3", reportsTo: "account-2" });
  await w.expectError(apply(w, { subjectRef: "account-1", reportsTo: "account-3" }), "cycle");
});

test("moving a manager keeps one current reports_to and closes the old one", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-4", reportsTo: "account-2" });
  await apply(w, { subjectRef: "account-4", reportsTo: "account-3" });
  const rows = (await w.db.query("SELECT manager_ref, effective_to FROM public.org_relationships WHERE subject_ref='account-4' ORDER BY effective_from, id")).rows;
  assert.deepEqual(rows.map((r) => [r.manager_ref, r.effective_to === null]), [["account-2", false], ["account-3", true]]);
});

test("intern supervision is independent of line management", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-3", reportsTo: "account-2" });
  await apply(w, { subjectRef: "intern-1", internSupervisor: "account-3" });
  const chart = await getChart(w.db, loadPeople);
  assert.deepEqual(chart.nodes["account-3"].supervisedInterns, ["intern-1"]);
  assert.deepEqual(chart.nodes["account-2"].supervisedInterns, []);   // the VP does not supervise interns
  assert.equal(chart.nodes["intern-1"].reportsTo, null);
});

test("changing a title never changes capabilities or account role", async () => {
  const w = await world();
  const before = JSON.stringify(await getUserCapabilities(w.db, w.vp));
  await apply(w, { subjectRef: "account-2", title: "VP of Engineering" });
  assert.equal(JSON.stringify(await getUserCapabilities(w.db, w.vp)), before);
  assert.equal((await w.db.query("SELECT role FROM public.ops_users WHERE id=$1", [w.vp])).rows[0].role, "Manager");
});

test("capabilities: a technical Superadmin has no organisational authority by default", async () => {
  const w = await world();
  assert.equal((await getUserCapabilities(w.db, w.tech)).length, 0);
  await w.expectError(grantCapability(w.db, { actor: w.actor(w.tech, "tech"), userId: w.tech, capability: "org.approve" }), "forbidden");
});

test("capabilities: no escalation - delegates can only hand out what they hold, and cannot self-grant", async () => {
  const w = await world();
  await grantCapability(w.db, { actor: w.A, userId: w.vp, capability: "org.view_all" });
  await grantCapability(w.db, { actor: w.A, userId: w.vp, capability: "org.propose" });
  await w.expectError(grantCapability(w.db, { actor: w.actor(w.vp, "vp"), userId: w.vp, capability: "org.approve" }), "forbidden");
  await grantCapability(w.db, { actor: w.A, userId: w.vp, capability: "org.delegate" });   // CEO explicitly delegates
  await w.expectError(grantCapability(w.db, { actor: w.actor(w.vp, "vp"), userId: w.tech, capability: "org.approve" }), "escalation");
  assert.equal(holds(await getUserCapabilities(w.db, w.vp), "intern.administer"), false); // supervising never grants it
});

test("the last holder of org.approve / org.delegate cannot be removed", async () => {
  const w = await world();
  await w.expectError(revokeCapability(w.db, { actor: w.A, userId: w.ceo, capability: "org.approve" }), "last_holder");
  await grantCapability(w.db, { actor: w.A, userId: w.vp, capability: "org.approve" });
  await revokeCapability(w.db, { actor: w.A, userId: w.ceo, capability: "org.approve" });
});

test("proposal workflow: propose, then approve applies; stale needs acknowledgement; reject changes nothing", async () => {
  const w = await world();
  const proposal = await createProposal(w.db, loadPeople, { actor: w.actor(w.vp, "vp"), input: { subjectRef: "account-4", title: "Senior Dev", reason: "Strong delivery" } });
  assert.equal((await getChart(w.db, loadPeople)).nodes["account-4"].title, null);   // nothing applied by proposing
  await apply(w, { subjectRef: "account-3", title: "Lead" });                        // org moves on
  await w.expectError(decideProposal(w.db, loadPeople, { actor: w.A, proposalId: proposal.id, decision: "approve" }), "stale");
  const done = await decideProposal(w.db, loadPeople, { actor: w.A, proposalId: proposal.id, decision: "approve", acknowledgeChanges: true });
  assert.equal(done.status, "approved");
  assert.equal((await getChart(w.db, loadPeople)).nodes["account-4"].title, "Senior Dev");
  await w.expectError(decideProposal(w.db, loadPeople, { actor: w.A, proposalId: proposal.id, decision: "reject" }), "decided");
  const second = await createProposal(w.db, loadPeople, { actor: w.actor(w.vp, "vp"), input: { subjectRef: "account-4", title: "Principal" } });
  await decideProposal(w.db, loadPeople, { actor: w.A, proposalId: second.id, decision: "reject", note: "Not yet" });
  assert.equal((await getChart(w.db, loadPeople)).nodes["account-4"].title, "Senior Dev");
  assert.equal((await listProposals(w.db, { status: "rejected" })).length, 1);
});

test("a proposal that could never be applied is refused up front", async () => {
  const w = await world();
  await w.expectError(createProposal(w.db, loadPeople, { actor: w.actor(w.vp, "vp"), input: { subjectRef: "account-5", title: "X" } }), "inactive");
});

test("chart reflects database state and supports as-of history", async () => {
  const w = await world();
  await apply(w, { subjectRef: "account-2", title: "VP", reportsTo: "account-1" });
  await new Promise((r) => setTimeout(r, 20));
  const mid = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 20));
  await apply(w, { subjectRef: "account-2", title: "CTO" });
  const now = await getChart(w.db, loadPeople);
  const past = await getChart(w.db, loadPeople, { asOf: mid });
  assert.equal(now.nodes["account-2"].title, "CTO");
  assert.equal(past.nodes["account-2"].title, "VP");
  assert.deepEqual(now.nodes["account-1"].directReports, ["account-2"]);
  const rows = (await w.db.query("SELECT subject_ref, manager_ref FROM public.org_relationships WHERE type='reports_to' AND effective_to IS NULL")).rows;
  const fromChart = Object.values(now.nodes).filter((n) => n.reportsTo).map((n) => [n.ref, n.reportsTo]).sort();
  assert.deepEqual(fromChart, rows.map((r) => [r.subject_ref, r.manager_ref]).sort());
});

test("preview returns the diff without writing", async () => {
  const w = await world();
  const v = await getVersion(w.db);
  const preview = await previewChange(w.db, loadPeople, { subjectRef: "account-2", title: "VP" });
  assert.ok(preview.summary.length);
  assert.equal(await getVersion(w.db), v);
  assert.equal((await w.db.query("SELECT count(*)::int c FROM public.org_changes WHERE kind='role.change'")).rows[0].c, 0);
});

test("schema is idempotent", async () => {
  const w = await world();
  const { ORG_SCHEMA_SQL } = await import("./schema.mjs");
  await w.pglite.exec(ORG_SCHEMA_SQL);
  await w.pglite.exec(ORG_SCHEMA_SQL);
});

test("converting an intern record to an employee persists, shows in the chart and is audited", async () => {
  const { applyChange, getChart, getVersion } = await import("./store.mjs");
  const { loadPeople, makeDb } = await import("./fixtures.mjs");
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "ceo" };
  const apply = async (input) => applyChange(w.db, loadPeople, { actor, input, expectedVersion: await getVersion(w.db) });
  await apply({ subjectRef: "intern-1", title: "Intern", internSupervisor: "account-3" });
  await apply({ subjectRef: "intern-1", employmentType: "Employee", title: "Head of Data Science", reportsTo: "account-1" });
  const chart = await getChart(w.db, loadPeople);
  const node = chart.nodes["intern-1"];
  assert.equal(node.employmentType, "Employee");
  assert.equal(node.reportsTo, "account-1");
  assert.equal(node.internSupervisor, null);
  assert.equal(chart.nodes["account-3"].supervisedInterns.includes("intern-1"), false);
  assert.equal(chart.nodes["account-1"].directReports.includes("intern-1"), true);
  const audit = (await w.db.query("SELECT before, after FROM public.org_changes WHERE kind = 'role.change' ORDER BY version_after DESC LIMIT 1")).rows[0];
  assert.equal(audit.before.employmentType, "Intern");
  assert.equal(audit.after.employmentType, "Employee");
});
