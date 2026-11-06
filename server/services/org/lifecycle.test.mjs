import assert from "node:assert/strict";
import test from "node:test";
import { OrgError } from "./plan.mjs";
import { endPersonOrg, recordNewPerson } from "./lifecycle.mjs";
import { applyChange, getChart, getVersion } from "./store.mjs";
import { loadPeople, makeDb } from "./fixtures.mjs";

const actor = { userId: null, name: "CEO" };

test("a newly added person gets an initial org record with a history entry", async () => {
  const { db, dept } = await makeDb();
  await dept("Engineering");
  const result = await recordNewPerson(db, { actor, ref: "account-4", title: "Developer", departmentName: "engineering", reportsTo: "account-3" });
  assert.equal(result.created, true);
  assert.equal((await recordNewPerson(db, { actor, ref: "account-4", title: "Other" })).created, false); // idempotent
  const chart = await getChart(db, loadPeople);
  assert.equal(chart.nodes["account-4"].title, "Developer");
  assert.equal(chart.nodes["account-4"].department, "Engineering");
  assert.equal(chart.nodes["account-4"].reportsTo, "account-3");
});

test("a person with reports, interns or leadership cannot be removed until reassigned", async () => {
  const { db, user, dept } = await makeDb();
  const eng = await dept("Engineering");
  const ceo = await user("ceo", "Manager");
  const A = { userId: ceo, name: "CEO" };
  await recordNewPerson(db, { actor: A, ref: "account-3", title: "Lead", departmentName: "Engineering" });
  await recordNewPerson(db, { actor: A, ref: "account-4", title: "Dev", departmentName: "Engineering", reportsTo: "account-3" });
  await assert.rejects(endPersonOrg(db, { actor: A, ref: "account-3" }), (e) => e instanceof OrgError && e.code === "has_responsibilities");
  await applyChange(db, loadPeople, { actor: A, input: { subjectRef: "account-4", reportsTo: "account-2" }, expectedVersion: await getVersion(db) });
  await applyChange(db, loadPeople, { actor: A, input: { subjectRef: "account-3", leadOfAdd: [eng] }, expectedVersion: await getVersion(db) });
  await assert.rejects(endPersonOrg(db, { actor: A, ref: "account-3" }), (e) => e.code === "has_responsibilities"); // still leads Engineering
  await applyChange(db, loadPeople, { actor: A, input: { subjectRef: "account-3", leadOfRemove: [eng] }, expectedVersion: await getVersion(db) });
  await endPersonOrg(db, { actor: A, ref: "account-3" });
  const rows = (await db.query("SELECT effective_to FROM public.org_assignments WHERE person_ref='account-3'")).rows;
  assert.equal(rows.length, 1);                 // history kept
  assert.ok(rows[0].effective_to);              // but closed
});

test("a new person is placed in a function by its current name or by the older name records use", async () => {
  const { createFunction } = await import("./structure.mjs");
  const { getVersion } = await import("./store.mjs");
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "ceo" };
  const tech = await createFunction(w.db, { actor, expectedVersion: await getVersion(w.db), name: "Technology & Engineering", legacyKeys: ["Engineering"] });
  await recordNewPerson(w.db, { actor, ref: "account-4", title: "Dev", departmentName: "Engineering" });                     // the key stored on old records
  await recordNewPerson(w.db, { actor, ref: "intern-1", title: "Intern", departmentName: "Technology & Engineering" });       // the new name
  const rows = (await w.db.query("SELECT person_ref, department_id FROM public.org_assignments WHERE effective_to IS NULL ORDER BY person_ref")).rows;
  assert.deepEqual(rows.map((row) => row.department_id), [tech.id, tech.id]);
});
