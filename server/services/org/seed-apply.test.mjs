import assert from "node:assert/strict";
import test from "node:test";
import { planSeed } from "./seed.mjs";
import { applySeed } from "./seed-apply.mjs";
import { getChart, getVersion } from "./store.mjs";
import { makeDb } from "./fixtures.mjs";

const accounts = [
  { id: 1, display_name: "Ada Chief", email: "ada.chief@example.test", department: "Engineering", reports_to_account_id: null },
  { id: 2, display_name: "Bo Vice", email: "bo.vice@example.test", department: "Data & Security", reports_to_account_id: 1 },
];
const interns = [
  { id: 1, full_name: "Ivy Intern", email: "ivy.intern@example.test", position: "AI Engineering", department: "Engineering", employment_status: "Active", supervisor_account_id: 2 },
  { id: 2, full_name: "Bo Vice", email: "bo.vice@example.test", position: "Old intern record", department: "", employment_status: "Active", supervisor_account_id: null },
];
const people = [
  { ref: "account-1", name: "Ada Chief", email: "a", employmentType: "Employee", active: true, status: "Active" },
  { ref: "account-2", name: "Bo Vice", email: "b", employmentType: "Employee", active: true, status: "Active" },
  { ref: "intern-1", name: "Ivy Intern", email: "i", employmentType: "Intern", active: true, status: "Active" },
  { ref: "intern-2", name: "Bo Vice", email: "b", employmentType: "Intern", active: true, status: "Active" },
];

test("the seed is idempotent and builds the expected chart", async () => {
  const { db } = await makeDb();
  const plan = planSeed({ accounts, interns });
  const first = await applySeed(db, plan);
  const version = await getVersion(db);
  const second = await applySeed(db, plan);
  assert.deepEqual(second, { departments: 0, assignments: 0, relationships: 0, links: 0, exclusions: 0 });
  assert.equal(await getVersion(db), version);
  assert.equal(first.departments, 4);

  const chart = await getChart(db, async () => people);
  assert.deepEqual(chart.nodes["account-1"].directReports, ["account-2"]);
  assert.deepEqual(chart.nodes["account-2"].supervisedInterns, ["intern-1"]);
  assert.equal(chart.nodes["intern-1"].title, "AI Engineering");
  assert.equal(chart.nodes["account-2"].title, "Title not set");
  assert.ok(chart.issues.some((i) => i.code === "no_title" && i.ref === "account-2"));
});

test("confirmed identity links remove the duplicate from the chart without deleting anything", async () => {
  const { db } = await makeDb();
  await applySeed(db, planSeed({ accounts, interns }, { links: { "intern-2": "account-2" } }));
  const chart = await getChart(db, async () => people);
  assert.equal(chart.nodes["intern-2"], undefined);
  assert.ok(chart.nodes["account-2"]);
  assert.equal(chart.counts.people, 3);
  assert.equal((await db.query("SELECT count(*)::int c FROM public.org_assignments WHERE person_ref='intern-2'")).rows[0].c, 1); // record kept
});

test("an excluded technical account is hidden and its reports surface as roots", async () => {
  const { db } = await makeDb();
  await applySeed(db, planSeed({ accounts, interns }, { exclusions: { "account-1": "Technical administration account" } }));
  const chart = await getChart(db, async () => people);
  assert.equal(chart.nodes["account-1"], undefined);
  assert.ok(chart.roots.includes("account-2"));
});

test("completed interns are hidden by status, not by name, unless alumni are requested", async () => {
  const { db } = await makeDb();
  await applySeed(db, planSeed({ accounts, interns }));
  const withAlumnus = [...people, { ref: "intern-9", name: "Old Timer", email: "o", employmentType: "Intern", active: false, status: "Completed" }];
  assert.equal((await getChart(db, async () => withAlumnus)).nodes["intern-9"], undefined);
  assert.ok((await getChart(db, async () => withAlumnus, { includeAlumni: true })).nodes["intern-9"]);
});
