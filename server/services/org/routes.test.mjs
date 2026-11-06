import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerOrgRoutes } from "./routes.mjs";
import { getVersion, grantCapability } from "./store.mjs";
import { loadPeople, makeDb } from "./fixtures.mjs";

async function boot({ enabled = true } = {}) {
  const w = await makeDb();
  const accounts = new Map();
  const add = async (name, role, caps = []) => {
    const id = await w.user(name, role);
    accounts.set(name, { id, email: `${name}@example.test`, display_name: name, app_role: role });
    for (const capability of caps) await grantCapability(w.db, { userId: id, capability, via: "bootstrap" });
    return id;
  };
  await w.dept("Engineering");
  await add("ceo", "Manager", ["org.view_all", "org.propose", "org.approve", "org.delegate"]);
  await add("vp", "Manager", ["org.view_all", "org.propose"]);
  await add("tech", "Superadmin");
  await add("intern", "Member");

  const app = express();
  app.use(express.json());
  const requireAuth = (request, response, next) => (request.headers["x-user"] ? next() : response.status(401).json({ error: "auth" }));
  const requireAccount = (request, _response, next) => { request.appAccount = accounts.get(request.headers["x-user"]); next(); };
  registerOrgRoutes(app, { db: w.db, loadPeople, requireAuth, requireAccount, isEnabled: () => enabled, notify: async () => {} });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (as, method, path, body) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(as ? { "x-user": as } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  return { ...w, accounts, call, close: () => server.close() };
}

test("authorisation matrix: view, propose, approve, delegate are separate and Superadmin grants nothing", async () => {
  const w = await boot();
  try {
    assert.equal((await w.call(null, "GET", "/api/org/chart")).status, 401);
    assert.equal((await w.call("tech", "GET", "/api/org/chart")).status, 403);           // technical Superadmin: no org authority
    assert.equal((await w.call("intern", "GET", "/api/org/chart")).status, 403);
    assert.equal((await w.call("vp", "GET", "/api/org/chart")).status, 200);
    const version = (await w.call("vp", "GET", "/api/org/me")).body.version;
    const input = { subjectRef: "account-4", title: "Senior Dev" };
    assert.equal((await w.call("vp", "POST", "/api/org/changes", { input, expectedVersion: version })).status, 403);   // VP cannot approve
    assert.equal((await w.call("tech", "POST", "/api/org/changes", { input, expectedVersion: version })).status, 403);
    assert.equal((await w.call("vp", "POST", "/api/org/capabilities", { userId: w.accounts.get("vp").id, capability: "org.approve" })).status, 403); // no self-escalation
    const proposal = await w.call("vp", "POST", "/api/org/proposals", { input });
    assert.equal(proposal.status, 201);
    assert.equal((await w.call("vp", "POST", `/api/org/proposals/${proposal.body.id}/decision`, { decision: "approve" })).status, 403);
    const applied = await w.call("ceo", "POST", "/api/org/changes", { input, expectedVersion: version });
    assert.equal(applied.status, 201);
    assert.equal((await w.call("ceo", "POST", "/api/org/changes", { input: { subjectRef: "account-4", title: "Staff" }, expectedVersion: version })).status, 409); // stale
    assert.equal((await w.call("ceo", "POST", "/api/org/changes", { input: { subjectRef: "account-4", title: "Staff" } })).status, 400);                  // version required
    const chart = await w.call("vp", "GET", "/api/org/chart");
    assert.equal(chart.body.nodes["account-4"].title, "Senior Dev");
    assert.equal("email" in chart.body.nodes["account-4"], false);   // the chart exposes no contact details
    const redundant = await w.call("ceo", "POST", `/api/org/proposals/${proposal.body.id}/decision`, { decision: "approve", acknowledgeChanges: true });
    assert.equal(redundant.status, 409);                       // already applied directly: approving would change nothing
    assert.equal(redundant.body.code, "no_change");
    assert.equal((await w.call("ceo", "POST", `/api/org/proposals/${proposal.body.id}/decision`, { decision: "reject", note: "Applied directly" })).status, 200);
  } finally { w.close(); }
});

test("a delegated, scoped capability works and can be revoked; the last approver is protected", async () => {
  const w = await boot();
  try {
    const vpId = w.accounts.get("vp").id;
    assert.equal((await w.call("ceo", "POST", "/api/org/capabilities", { userId: vpId, capability: "org.approve" })).status, 201);
    const version = await getVersion(w.db);
    assert.equal((await w.call("vp", "POST", "/api/org/changes", { input: { subjectRef: "account-4", title: "X" }, expectedVersion: version })).status, 201);
    assert.equal((await w.call("ceo", "DELETE", "/api/org/capabilities", { userId: vpId, capability: "org.approve" })).status, 200);
    assert.equal((await w.call("vp", "POST", "/api/org/changes", { input: { subjectRef: "account-4", title: "Y" }, expectedVersion: await getVersion(w.db) })).status, 403);
    const ceoId = w.accounts.get("ceo").id;
    assert.equal((await w.call("ceo", "DELETE", "/api/org/capabilities", { userId: ceoId, capability: "org.approve" })).status, 409);   // last holder
  } finally { w.close(); }
});

test("everything is blocked with a clear message when the module is disabled", async () => {
  const w = await boot({ enabled: false });
  try {
    const chart = await w.call("ceo", "GET", "/api/org/chart");
    assert.equal(chart.status, 503);
    assert.equal(chart.body.code, "disabled");
    assert.equal((await w.call("ceo", "GET", "/api/org/me")).body.enabled, false);
  } finally { w.close(); }
});
