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
