import { OrgError } from "../org/plan.mjs";
import { PERSONAL_EVENT_KINDS, REMINDER_CHOICES } from "./schema.mjs";

// All reads and writes are scoped to ownerUserId. There is no way to address another person's event: an id that
// belongs to someone else behaves exactly like an id that does not exist.

const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
const isTime = (value) => typeof value === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
const COLUMNS = `id, kind, title, event_date::text AS date, start_time, end_time, location, detail, reminder_minutes, completed, completed_at`;
const shape = (row) => ({ id: row.id, kind: row.kind, title: row.title, date: row.date, startTime: row.start_time, endTime: row.end_time, location: row.location, detail: row.detail, reminderMinutes: row.reminder_minutes, completed: row.completed, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null });

/** The table is added by a migration. Until then the feature reports "not available" instead of failing. */
const knownReady = new WeakSet();   // once the table exists it stays: skip the extra round-trip on every request
export async function personalCalendarReady(db) {
  if (knownReady.has(db)) return true;
  const ok = Boolean((await db.query("SELECT to_regclass('public.personal_calendar_events') IS NOT NULL AS ok")).rows[0].ok);
  if (ok) knownReady.add(db);
  return ok;
}

/** Events with a date in [from, to] (inclusive), oldest first. */
export async function listEvents(db, { ownerUserId, from, to }) {
  if (!isDate(from) || !isDate(to) || from > to) throw new OrgError("Choose a valid date range.");
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM public.personal_calendar_events
     WHERE owner_user_id = $1 AND event_date BETWEEN $2::date AND $3::date
     ORDER BY event_date, start_time NULLS FIRST, created_at LIMIT 2000`, [ownerUserId, from, to]);
  return rows.map(shape);
}

function validate(input, { creating }) {
  const out = {};
  if (input.title !== undefined || creating) {
    out.title = clean(input.title, 160);
    if (out.title.length < 2) throw new OrgError("Give the event a title.");
  }
  if (input.kind !== undefined || creating) {
    out.kind = input.kind ?? "meeting";
    if (!PERSONAL_EVENT_KINDS.includes(out.kind)) throw new OrgError("Choose a valid event type.");
  }
  if (input.date !== undefined || creating) {
    out.date = input.date;
    if (!isDate(out.date)) throw new OrgError("Choose a date for this event.");
  }
  for (const [key, label] of [["startTime", "start time"], ["endTime", "end time"]]) {
    if (input[key] !== undefined) {
      out[key] = input[key] || null;
      if (out[key] !== null && !isTime(out[key])) throw new OrgError(`Enter the ${label} as HH:MM.`);
    }
  }
  if (input.location !== undefined) out.location = clean(input.location, 160);
  if (input.detail !== undefined) out.detail = clean(input.detail, 500);
  if (input.reminderMinutes !== undefined) {
    out.reminderMinutes = input.reminderMinutes === null || input.reminderMinutes === "" ? null : Number(input.reminderMinutes);
    if (out.reminderMinutes !== null && !REMINDER_CHOICES.includes(out.reminderMinutes)) throw new OrgError("Choose a valid reminder.");
  }
  if (input.completed !== undefined) out.completed = Boolean(input.completed);
  return out;
}

export async function saveEvent(db, { ownerUserId, id = null, ...input }) {
  const fields = validate(input, { creating: !id });
  if (!id) {
    const start = fields.startTime ?? null;
    const end = fields.endTime ?? null;
    if (end && !start) throw new OrgError("Add a start time before an end time.");
    if (end && end < start) throw new OrgError("The end time cannot be before the start time.");
    if (fields.reminderMinutes != null && !start && fields.reminderMinutes !== 1440 && fields.reminderMinutes !== 0) {
      throw new OrgError("A reminder before the event needs a start time (or choose one day before).");
    }
    const { rows } = await db.query(
      `INSERT INTO public.personal_calendar_events (owner_user_id, kind, title, event_date, start_time, end_time, location, detail, reminder_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
      [ownerUserId, fields.kind, fields.title, fields.date, start, end, fields.location ?? "", fields.detail ?? "", fields.reminderMinutes ?? null]);
    return shape(rows[0]);
  }
  const current = (await db.query("SELECT start_time, end_time FROM public.personal_calendar_events WHERE id::text = $1 AND owner_user_id = $2", [String(id), ownerUserId])).rows[0];
  if (!current) throw new OrgError("That event could not be found.", 404, "not_found");
  const start = fields.startTime === undefined ? current.start_time : fields.startTime;
  const end = fields.endTime === undefined ? current.end_time : fields.endTime;
  if (end && !start) throw new OrgError("Add a start time before an end time.");
  if (end && end < start) throw new OrgError("The end time cannot be before the start time.");
  const { rows } = await db.query(
    `UPDATE public.personal_calendar_events SET
       title = COALESCE($3, title), kind = COALESCE($4, kind), event_date = COALESCE($5::date, event_date),
       start_time = CASE WHEN $6::boolean THEN $7 ELSE start_time END, end_time = CASE WHEN $8::boolean THEN $9 ELSE end_time END,
       location = COALESCE($10, location), detail = COALESCE($11, detail),
       reminder_minutes = CASE WHEN $12::boolean THEN $13::integer ELSE reminder_minutes END,
       completed = COALESCE($14, completed),
       completed_at = CASE WHEN $14::boolean IS TRUE THEN COALESCE(completed_at, now()) WHEN $14::boolean IS FALSE THEN NULL ELSE completed_at END,
       updated_at = now()
     WHERE id::text = $1 AND owner_user_id = $2 RETURNING ${COLUMNS}`,
    [String(id), ownerUserId, fields.title ?? null, fields.kind ?? null, fields.date ?? null,
      fields.startTime !== undefined, fields.startTime ?? null, fields.endTime !== undefined, fields.endTime ?? null,
      fields.location ?? null, fields.detail ?? null, fields.reminderMinutes !== undefined, fields.reminderMinutes ?? null, fields.completed ?? null]);
  return shape(rows[0]);
}

export async function deleteEvent(db, { ownerUserId, id }) {
  const { rowCount } = await db.query("DELETE FROM public.personal_calendar_events WHERE id::text = $1 AND owner_user_id = $2", [String(id), ownerUserId]);
  if (!rowCount) throw new OrgError("That event could not be found.", 404, "not_found");
  return { id };
}
