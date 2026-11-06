import { OrgError } from "../org/plan.mjs";
import { getUserCapabilities, holds } from "../org/store.mjs";
import { deleteEvent, listEvents, personalCalendarReady, saveEvent } from "./store.mjs";

/**
 * /api/me/calendar: the CEO's private calendar. Two checks on every call, both on the server:
 *   1. the caller is a Superadmin who also holds the organisational approval authority (the CEO), and
 *   2. every query is scoped to the caller's own account, so nobody can read or change anyone else's events.
 */
export function registerPersonalCalendarRoutes(app, { db, requireAuth, requireAccount }) {
  const base = [requireAuth, requireAccount];
  const isCeo = async (request) => request.appAccount.app_role === "Superadmin" && holds(await getUserCapabilities(db, request.appAccount.id), "org.approve");

  const guard = (handler, { needsReady = true } = {}) => async (request, response) => {
    try {
      if (!(await isCeo(request))) return response.status(403).json({ error: "This calendar is only available to the CEO.", code: "forbidden" });
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
