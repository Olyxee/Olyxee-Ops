import assert from "node:assert/strict";
import test from "node:test";
import { applyChange, getChart, getVersion } from "./store.mjs";
import { applyFunctionsMigration } from "./functions-migration.mjs";
import { buildFunctionsView, functionLookup } from "./functions-view.mjs";
import { makeDb, person } from "./fixtures.mjs";

const PEOPLE = [
  person("account-1", "Alice VP", { email: "alice@x.test" }),
  person("account-2", "Eve Research", { email: "eve@x.test" }),
  person("account-3", "Moe Data", { email: "moe@x.test" }),
  person("account-17", "Carl CEO", { email: "ceo@x.test" }),
  person("intern-13", "Theo Head", { email: "theo@x.test" }),       // recorded as an intern, converted to employee below
  person("intern-14", "Mia Intern", { email: "mia@x.test" }),
  person("intern-31", "Zed Eng", { email: "zed@x.test" }),           // stays an intern record
  person("intern-33", "Abe Intern", { email: "abe@x.test" }),
  person("intern-34", "Tia Intern", { email: "tia@x.test" }),
  person("intern-35", "Jay Intern", { email: "jay@x.test" }),
];
const loadPeople = async () => PEOPLE;

const CONFIG = {
  functions: [
    { from: "Engineering", name: "Technology & Engineering", legacy: ["Engineering"], order: 10, description: "Tech.", leader: "alice@x.test" },
    { from: "Data & Security", name: "Data Science & Intelligence", legacy: ["Data & Security"], order: 20, description: "Data science.", leader: "theo@x.test" },
    { from: "Sales & Marketing", name: "Growth & Partnerships", legacy: ["Sales & Marketing"], order: 30, description: "Growth.", leader: "ceo@x.test" },
  ],
  specialisations: [
    { from: "Research & Development (R&D)", name: "AI Research & Development", legacy: ["Research & Development (R&D)"], order: 11, description: "AI.", leader: "eve@x.test" },
    { name: "Data Engineering", legacy: [], order: 12, description: "Data eng.", leader: "moe@x.test" },
    { name: "Software Engineering", legacy: [], order: 13, description: "Software.", leader: "zed@x.test" },
  ],
  parent: "Technology & Engineering",
  placement: {
    "alice@x.test": "Technology & Engineering", "eve@x.test": "AI Research & Development", "mia@x.test": "AI Research & Development",
    "moe@x.test": "Data Engineering", "tia@x.test": "Data Engineering", "zed@x.test": "Software Engineering", "jay@x.test": "Software Engineering",
    "theo@x.test": "Data Science & Intelligence", "abe@x.test": "Growth & Partnerships",
  },
};

async function legacyWorld() {
  const w = await makeDb();
  const userId = await w.user("ceo", "Manager");
  const actor = { userId, name: "Carl CEO" };
  const dept = {};
  for (const name of ["Engineering", "Research & Development (R&D)", "Data & Security", "Sales & Marketing"]) dept[name] = await w.dept(name);
  const change = async (input) => applyChange(w.db, loadPeople, { actor, expectedVersion: await getVersion(w.db), input });
  const home = { "account-1": "Engineering", "account-2": "Research & Development (R&D)", "account-3": "Data & Security", "intern-13": "Data & Security",
    "intern-14": "Engineering", "intern-31": "Research & Development (R&D)", "intern-33": "Sales & Marketing", "intern-34": "Data & Security", "intern-35": "Engineering" };
  const titles = { "account-1": "VP of Engineering", "account-2": "AI Research Lead", "account-3": "Data Engineering Lead", "account-17": "Founder & CEO", "intern-13": "Head of Data Science",
    "intern-14": "AI Engineering Intern", "intern-31": "Founding Software Engineer", "intern-33": "Growth Intern", "intern-34": "Cybersecurity Intern", "intern-35": "QA Intern" };
  for (const [ref, title] of Object.entries(titles)) await change({ subjectRef: ref, title, ...(home[ref] ? { departmentId: dept[home[ref]] } : {}) });
  for (const ref of ["account-1", "account-17"]) void ref;
  await change({ subjectRef: "account-1", reportsTo: "account-17" });
  await change({ subjectRef: "account-2", reportsTo: "account-1" });
  await change({ subjectRef: "account-3", reportsTo: "account-1" });
  await change({ subjectRef: "intern-13", employmentType: "Employee", reportsTo: "account-17" });
  await change({ subjectRef: "intern-31", reportsTo: "account-1" });
  await change({ subjectRef: "intern-14", internSupervisor: "account-2" });
  await change({ subjectRef: "intern-34", internSupervisor: "account-3" });
  await change({ subjectRef: "intern-35", internSupervisor: "intern-31" });
  await change({ subjectRef: "intern-33", internSupervisor: "account-17" });
  return { ...w, actor, dept };
}

const snapshotOf = (chart) => Object.fromEntries(Object.values(chart.nodes).map((n) => [n.ref, { title: n.title, type: n.employmentType, reportsTo: n.reportsTo, supervisor: n.internSupervisor }]));

test("the migration reshapes departments into functions without losing or changing anything else", async () => {
  const w = await legacyWorld();
  const before = await getChart(w.db, loadPeople);
  const historyBefore = (await w.db.query("SELECT count(*)::int n FROM public.org_assignments")).rows[0].n;
  const logs = [];
  await applyFunctionsMigration(w.db, loadPeople, w.actor, CONFIG, { log: (line) => logs.push(line) });
  const after = await getChart(w.db, loadPeople);

  // existing rows are re-used (same stable ids), plus exactly the two new specialisations
  const rows = (await w.db.query("SELECT id, name, kind, active FROM public.org_departments")).rows;
  assert.equal(rows.length, 6);
  for (const [oldName, newName] of [["Engineering", "Technology & Engineering"], ["Data & Security", "Data Science & Intelligence"], ["Sales & Marketing", "Growth & Partnerships"], ["Research & Development (R&D)", "AI Research & Development"]]) {
    assert.equal(rows.find((r) => r.id === w.dept[oldName]).name, newName);
  }
  assert.equal(rows.every((r) => r.active), true);

  // titles, employment types and every reporting / supervision line are exactly as before
  assert.deepEqual(snapshotOf(after), snapshotOf(before));
  assert.equal(after.nodes["intern-35"].internSupervisor, "intern-31");                         // Jacob stays under Muhammad
  assert.equal(after.nodes["account-1"].supervisedInterns.length, 0);                           // the VP supervises no interns

  // the functions page data: three functions, in order, with leaders and members from the database
  const view = buildFunctionsView(after);
  assert.deepEqual(view.functions.map((f) => f.name), ["Technology & Engineering", "Data Science & Intelligence", "Growth & Partnerships"]);
  const [tech, science, growth] = view.functions;
  assert.equal(tech.leader.name, "Alice VP");
  assert.equal(science.leader.name, "Theo Head");
  assert.equal(growth.leader.name, "Carl CEO");
  assert.deepEqual(tech.specialisations.map((s) => s.name), ["AI Research & Development", "Data Engineering", "Software Engineering"]);
  assert.deepEqual(tech.specialisations.map((s) => s.leader?.name ?? null), ["Eve Research", "Moe Data", null]);   // Zed is an intern record: no leader yet
  assert.deepEqual([...tech.memberRefs].sort(), ["account-1", "account-2", "account-3", "intern-14", "intern-31", "intern-34", "intern-35"]);
  assert.deepEqual(science.memberRefs, ["intern-13"]);
  assert.deepEqual(growth.memberRefs, ["intern-33"]);
  assert.equal(view.functions.some((f) => f.memberRefs.includes("account-17")), false);         // the CEO is above the functions, not a member
  assert.equal(after.roots.length, 1);
  assert.equal(after.roots[0], "account-17");
  assert.equal(after.issues.length, 0);
  assert.ok(logs.some((line) => /Zed Eng/.test(line)), "the skipped leader is reported");

  // old department names still resolve, so existing tasks and people keep their place
  const lookup = functionLookup(view);
  assert.equal(lookup.get("engineering"), "Technology & Engineering");
  assert.equal(lookup.get("research & development (r&d)"), "Technology & Engineering");
  assert.equal(lookup.get("data & security"), "Data Science & Intelligence");
  assert.equal(lookup.get("sales & marketing"), "Growth & Partnerships");

  // history is only ever added to
  const historyAfter = (await w.db.query("SELECT count(*)::int n FROM public.org_assignments")).rows[0].n;
  assert.ok(historyAfter > historyBefore);
});

test("the migration can be run twice safely", async () => {
  const w = await legacyWorld();
  await applyFunctionsMigration(w.db, loadPeople, w.actor, CONFIG);
  const version = await getVersion(w.db);
  const first = JSON.stringify((await w.db.query("SELECT id, name, parent_id, legacy_keys FROM public.org_departments ORDER BY id")).rows);
  await applyFunctionsMigration(w.db, loadPeople, w.actor, CONFIG);
  assert.equal(await getVersion(w.db), version);                                                  // nothing changed, nothing recorded
  assert.equal(JSON.stringify((await w.db.query("SELECT id, name, parent_id, legacy_keys FROM public.org_departments ORDER BY id")).rows), first);
});

test("leadership is replaced through the same workflow and the view follows immediately", async () => {
  const w = await legacyWorld();
  await applyFunctionsMigration(w.db, loadPeople, w.actor, CONFIG);
  const tech = (await w.db.query("SELECT id FROM public.org_departments WHERE name = 'Technology & Engineering'")).rows[0].id;
  await applyChange(w.db, loadPeople, { actor: w.actor, expectedVersion: await getVersion(w.db), input: { subjectRef: "account-2", leadOfAdd: [tech] } });
  const view = buildFunctionsView(await getChart(w.db, loadPeople));
  assert.equal(view.functions[0].leader.name, "Eve Research");
  const history = (await w.db.query("SELECT count(*)::int n FROM public.org_department_leads WHERE department_id = $1", [tech])).rows[0].n;
  assert.equal(history, 2);                                                                       // the previous leader stays in the record
});
