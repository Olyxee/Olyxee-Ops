import { OrgError } from "../org/plan.mjs";
import { getUserCapabilities, holds } from "../org/store.mjs";
import { deleteEvent, grantPersonalCalendar, hasPersonalCalendarAccess, listEvents, personalCalendarReady, revokePersonalCalendar, saveEvent } from "./store.mjs";

/**
 * /api/me/calendar: a private calendar and agenda. Two checks on every call, both on the server:
 *   1. the caller is the CEO (a Superadmin who also holds the organisational approval authority) or has been
 *      given a personal calendar by the CEO, and
 *   2. every query is scoped to the caller's own account, so nobody can read or change anyone else's events.
 * Only the CEO can give or take away a personal calendar.
 */
export function registerPersonalCalendarRoutes(app, { db, requireAuth, requireAccount }) {
  const base = [requireAuth, requireAccount];
  const isCeo = async (request) => request.appAccount.app_role === "Superadmin" && holds(await getUserCapabilities(db, request.appAccount.id), "org.approve");

  const canUse = async (request) => (await isCeo(request)) || (await hasPersonalCalendarAccess(db, request.appAccount.id));

  const guard = (handler, { needsReady = true, ceoOnly = false } = {}) => async (request, response) => {
    try {
      if (!(ceoOnly ? await isCeo(request) : await canUse(request))) return response.status(403).json({ error: ceoOnly ? "Only the CEO can manage who has a calendar." : "You do not have a personal calendar.", code: "forbidden" });
      if (needsReady && !(await personalCalendarReady(db))) return response.status(503).json({ error: "The calendar is not set up yet.", code: "not_ready" });
      return await handler(request, response);
    } catch (error) {
      if (error instanceof OrgError) return response.status(error.status).json({ error: error.message, code: error.code });
      console.error("Calendar request failed:", error instanceof Error ? error.message : "Unknown error");
      return response.status(500).json({ error: "The calendar request could not be completed." });
    }
  };
  const fields = (body) => {
    const { kind, title, date, startTime, endTime, location, detail, reminderMinutes, completed } = body || {};
    return { kind, title, date, startTime, endTime, location, detail, reminderMinutes, completed };
  };

  // Whether to show the calendar and agenda at all. Never an error: people without one simply get enabled: false.
  app.get("/api/me/calendar/access", ...base, async (request, response) => {
    try { response.json({ enabled: await canUse(request), canManage: await isCeo(request) }); }
    catch { response.json({ enabled: false, canManage: false }); }
  });
  app.put("/api/me/calendar/access/:userId", ...base, guard(async (request, response) =>
    response.json(await grantPersonalCalendar(db, { userId: request.params.userId, grantedBy: request.appAccount.id })), { ceoOnly: true }));
  app.delete("/api/me/calendar/access/:userId", ...base, guard(async (request, response) =>
    response.json(await revokePersonalCalendar(db, { userId: request.params.userId })), { ceoOnly: true, needsReady: false }));

  app.get("/api/me/calendar", ...base, guard(async (request, response) => {
    if (!(await personalCalendarReady(db))) return response.json({ available: false });
    response.json({ available: true, events: await listEvents(db, { ownerUserId: request.appAccount.id, from: String(request.query.from || ""), to: String(request.query.to || "") }) });
  }, { needsReady: false }));

  app.post("/api/me/calendar/events", ...base, guard(async (request, response) =>
    response.status(201).json(await saveEvent(db, { ownerUserId: request.appAccount.id, ...fields(request.body) }))));

  app.patch("/api/me/calendar/events/:id", ...base, guard(async (request, response) =>
    response.json(await saveEvent(db, { ownerUserId: request.appAccount.id, id: request.params.id, ...fields(request.body) }))));

  app.delete("/api/me/calendar/events/:id", ...base, guard(async (request, response) =>
    response.json(await deleteEvent(db, { ownerUserId: request.appAccount.id, id: request.params.id }))));
}
