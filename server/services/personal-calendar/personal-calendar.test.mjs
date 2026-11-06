import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { makeDb } from "../org/fixtures.mjs";
import { grantCapability } from "../org/store.mjs";
import { PERSONAL_CALENDAR_SCHEMA_SQL } from "./schema.mjs";
import { registerPersonalCalendarRoutes } from "./routes.mjs";
import { personalCalendarReady } from "./store.mjs";

async function boot({ migrate = true } = {}) {
  const w = await makeDb();
  if (migrate) await w.pglite.exec(PERSONAL_CALENDAR_SCHEMA_SQL);
  const accounts = new Map();
  const add = async (name, role, caps = []) => {
    const id = await w.user(name, role);
    accounts.set(name, { id, email: `${name}@example.test`, display_name: name, app_role: role });
    for (const capability of caps) await grantCapability(w.db, { userId: id, capability, via: "bootstrap" });
  };
  await add("ceo", "Superadmin", ["org.approve"]);
  await add("ceo2", "Superadmin", ["org.approve"]);          // another account with the same authority: still cannot see the first one's events
  await add("tech", "Superadmin");                           // a technical Superadmin without the CEO's authority
  await add("manager", "Manager", ["org.approve"]);          // approval authority alone is not enough
  await add("member", "Member");
  await add("vp", "Manager");                                // the VP: gets a calendar only if the CEO grants one
  const app = express();
  app.use(express.json());
  const requireAuth = (request, response, next) => (request.headers["x-user"] ? next() : response.status(401).json({ error: "auth" }));
  const requireAccount = (request, _response, next) => { request.appAccount = accounts.get(request.headers["x-user"]); next(); };
  registerPersonalCalendarRoutes(app, { db: w.db, requireAuth, requireAccount });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (as, method, path, body) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(as ? { "x-user": as } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  return { ...w, accounts, call, close: () => server.close() };
}
const RANGE = "from=2026-11-01&to=2026-12-31";

test("only the CEO can use the calendar; everyone else is refused by the server", async () => {
  const w = await boot();
  try {
    assert.equal((await w.call(null, "GET", `/api/me/calendar?${RANGE}`)).status, 401);
    for (const who of ["tech", "manager", "member"]) {
      assert.equal((await w.call(who, "GET", `/api/me/calendar?${RANGE}`)).status, 403, `${who} must not read`);
      assert.equal((await w.call(who, "POST", "/api/me/calendar/events", { title: "x", date: "2026-11-12" })).status, 403, `${who} must not write`);
    }
    assert.equal((await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).status, 200);
  } finally { w.close(); }
});

test("events are private to their owner: another CEO account cannot see, change, complete or delete them", async () => {
  const w = await boot();
  try {
    const created = await w.call("ceo", "POST", "/api/me/calendar/events", { title: "Board prep", date: "2026-11-12", kind: "meeting", startTime: "09:00" });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.deepEqual((await w.call("ceo2", "GET", `/api/me/calendar?${RANGE}`)).body.events, []);
    assert.equal((await w.call("ceo2", "PATCH", `/api/me/calendar/events/${id}`, { title: "Hijack" })).status, 404);
    assert.equal((await w.call("ceo2", "PATCH", `/api/me/calendar/events/${id}`, { completed: true })).status, 404);
    assert.equal((await w.call("ceo2", "DELETE", `/api/me/calendar/events/${id}`)).status, 404);
    const mine = (await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).body.events;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].title, "Board prep");                                            // untouched
  } finally { w.close(); }
});

test("create, edit, complete and delete; everything persists and is read back from the database", async () => {
  const w = await boot();
  try {
    const { body: event } = await w.call("ceo", "POST", "/api/me/calendar/events", { title: "Leadership meeting", kind: "meeting", date: "2026-11-12", startTime: "09:00", endTime: "10:00", location: "Internal", reminderMinutes: 15 });
    assert.deepEqual([event.title, event.kind, event.date, event.startTime, event.endTime, event.location, event.reminderMinutes, event.completed], ["Leadership meeting", "meeting", "2026-11-12", "09:00", "10:00", "Internal", 15, false]);
    const edited = await w.call("ceo", "PATCH", `/api/me/calendar/events/${event.id}`, { title: "Leadership offsite", date: "2026-11-13", endTime: null, reminderMinutes: null });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.body.title, edited.body.date, edited.body.startTime, edited.body.endTime, edited.body.reminderMinutes, edited.body.location], ["Leadership offsite", "2026-11-13", "09:00", null, null, "Internal"]);   // untouched fields stay
    const done = await w.call("ceo", "PATCH", `/api/me/calendar/events/${event.id}`, { completed: true });
    assert.equal(done.body.completed, true);
    assert.ok(done.body.completedAt);
    assert.equal((await w.call("ceo", "PATCH", `/api/me/calendar/events/${event.id}`, { completed: false })).body.completedAt, null);
    const stored = (await w.db.query("SELECT title, event_date::text d, completed FROM public.personal_calendar_events")).rows;   // what a refresh or a new session would read
    assert.deepEqual(stored, [{ title: "Leadership offsite", d: "2026-11-13", completed: false }]);
    assert.equal((await w.call("ceo", "DELETE", `/api/me/calendar/events/${event.id}`)).status, 200);
    assert.deepEqual((await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).body.events, []);
    assert.equal((await w.call("ceo", "DELETE", `/api/me/calendar/events/${event.id}`)).status, 404);
  } finally { w.close(); }
});

test("the range query returns only the requested dates, oldest first", async () => {
  const w = await boot();
  try {
    for (const [title, date] of [["c", "2026-12-05"], ["a", "2026-11-02"], ["out", "2027-02-01"], ["b", "2026-11-20"]]) await w.call("ceo", "POST", "/api/me/calendar/events", { title: `Event ${title}`, date, kind: "reminder" });
    const events = (await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).body.events;
    assert.deepEqual(events.map((event) => event.title), ["Event a", "Event b", "Event c"]);
    assert.equal((await w.call("ceo", "GET", "/api/me/calendar?from=2026-12-01&to=2026-11-01")).status, 400);
  } finally { w.close(); }
});

test("bad input is rejected with a clear message and nothing is saved", async () => {
  const w = await boot();
  try {
    const post = (body) => w.call("ceo", "POST", "/api/me/calendar/events", body);
    assert.equal((await post({ title: "x", date: "2026-11-12" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "tomorrow" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", kind: "party" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", startTime: "25:00" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", startTime: "10:00", endTime: "09:00" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", endTime: "09:00" })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", reminderMinutes: 7 })).status, 400);
    assert.equal((await post({ title: "Ok title", date: "2026-11-12", startTime: null, reminderMinutes: 15 })).status, 400);     // "15 minutes before" needs a time
    assert.equal((await w.db.query("SELECT count(*)::int n FROM public.personal_calendar_events")).rows[0].n, 0);
  } finally { w.close(); }
});

test("before the migration the app keeps working: reads say 'not available', writes explain why", async () => {
  const w = await boot({ migrate: false });
  try {
    assert.equal(await personalCalendarReady(w.db), false);
    assert.deepEqual((await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).body, { available: false });
    const write = await w.call("ceo", "POST", "/api/me/calendar/events", { title: "Ok title", date: "2026-11-12" });
    assert.equal(write.status, 503);
    assert.equal(write.body.code, "not_ready");
    assert.equal((await w.call("member", "GET", `/api/me/calendar?${RANGE}`)).status, 403);                                       // the gate comes first
  } finally { w.close(); }
});

test("the CEO can give someone a calendar; it is private to them, and only the CEO can grant or revoke", async () => {
  const w = await boot();
  try {
    const vpId = w.accounts.get("vp").id;
    assert.deepEqual((await w.call("vp", "GET", "/api/me/calendar/access")).body, { enabled: false, canManage: false });
    assert.equal((await w.call("vp", "GET", `/api/me/calendar?${RANGE}`)).status, 403);                            // not yet
    assert.deepEqual((await w.call("ceo", "GET", "/api/me/calendar/access")).body, { enabled: true, canManage: true });

    for (const who of ["vp", "manager", "member", "tech"]) assert.equal((await w.call(who, "PUT", `/api/me/calendar/access/${vpId}`)).status, 403, `${who} cannot grant`);
    assert.equal((await w.call("ceo", "PUT", "/api/me/calendar/access/00000000-0000-0000-0000-000000000000")).status, 404);
    assert.equal((await w.call("ceo", "PUT", `/api/me/calendar/access/${vpId}`)).status, 200);
    assert.equal((await w.call("ceo", "PUT", `/api/me/calendar/access/${vpId}`)).status, 200);                      // granting twice is harmless

    assert.deepEqual((await w.call("vp", "GET", "/api/me/calendar/access")).body, { enabled: true, canManage: false });
    const mine = await w.call("vp", "POST", "/api/me/calendar/events", { title: "Engineering sync", date: "2026-11-12", kind: "meeting", startTime: "10:00" });
    assert.equal(mine.status, 201);
    await w.call("ceo", "POST", "/api/me/calendar/events", { title: "Board prep", date: "2026-11-12", kind: "meeting" });
    assert.deepEqual((await w.call("vp", "GET", `/api/me/calendar?${RANGE}`)).body.events.map((e) => e.title), ["Engineering sync"]);   // only their own
    assert.deepEqual((await w.call("ceo", "GET", `/api/me/calendar?${RANGE}`)).body.events.map((e) => e.title), ["Board prep"]);
    assert.equal((await w.call("ceo", "PATCH", `/api/me/calendar/events/${mine.body.id}`, { title: "Hijack" })).status, 404);   // not even the CEO can touch it
    assert.equal((await w.call("vp", "PUT", `/api/me/calendar/access/${vpId}`)).status, 403);                        // having a calendar is not authority over who else has one

    assert.equal((await w.call("manager", "DELETE", `/api/me/calendar/access/${vpId}`)).status, 403);
    assert.equal((await w.call("ceo", "DELETE", `/api/me/calendar/access/${vpId}`)).status, 200);
    assert.equal((await w.call("vp", "GET", `/api/me/calendar?${RANGE}`)).status, 403);                              // access gone...
    assert.equal((await w.db.query("SELECT count(*)::int n FROM public.personal_calendar_events WHERE owner_user_id = $1", [vpId])).rows[0].n, 1);   // ...but nothing is deleted
    await w.call("ceo", "PUT", `/api/me/calendar/access/${vpId}`);
    assert.equal((await w.call("vp", "GET", `/api/me/calendar?${RANGE}`)).body.events.length, 1);                    // and it all comes back
  } finally { w.close(); }
});
