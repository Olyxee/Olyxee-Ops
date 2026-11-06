// Rules for the CEO's calendar and agenda. Pure functions over the saved events: the calendar card and the agenda card
// call the same code on the same data, so a change in one is a change in the other.

export const KIND_LABELS = Object.freeze({ meeting: "Meeting", important_date: "Important date", deadline: "Deadline", follow_up: "Follow-up", reminder: "Reminder" });
export const REMINDER_LABELS = Object.freeze({ 0: "At the time", 5: "5 minutes before", 15: "15 minutes before", 30: "30 minutes before", 60: "1 hour before", 1440: "1 day before" });

const pad = (value) => String(value).padStart(2, "0");
export const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parseDay = (day) => new Date(`${day}T00:00:00`);

export function shortDate(day) {
  const date = parseDay(day);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "Today", "Tomorrow", or "Fri 14 Nov". */
export function whenLabel(day, today) {
  if (day === today) return "Today";
  const tomorrow = parseDay(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return day === localDay(tomorrow) ? "Tomorrow" : shortDate(day);
}

/** The moment an event happens, for ordering and reminders. All-day events count as 09:00. */
export function eventMoment(event) {
  return new Date(`${event.date}T${event.startTime || "09:00"}:00`);
}

const timeRange = (event) => (event.startTime ? (event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime) : "All day");

/** The second line shown under a title: the person's own note when there is one, otherwise a sensible default. */
export function agendaSubtitle(event, today) {
  const when = event.date === today ? null : whenLabel(event.date, today);
  const join = (...parts) => parts.filter(Boolean).join(" · ");
  if (event.kind === "meeting") return join(when, timeRange(event), event.location);
  if (event.detail) return join(event.kind === "follow_up" || event.kind === "reminder" ? when : null, event.detail);
  if (event.kind === "follow_up") return join(when, "Awaiting your response");
  if (event.kind === "deadline") return event.date === today ? "Due today" : `Due ${shortDate(event.date)}`;
  if (event.kind === "important_date") return join(when, event.startTime || "");
  return join(when, event.startTime || "");
}

/**
 * The CEO's agenda: open commitments that still need them. Overdue follow-ups, deadlines and reminders come first, then
 * everything that is still ahead (today first). Meetings and dates that have already passed are history, not agenda.
 * now = a Date. Returns every relevant item; the card shows the first three.
 */
export function buildAgenda(events, now, { includeCompleted = false } = {}) {
  const today = localDay(now);
  const time = localTime(now);
  const items = [];
  for (const event of events) {
    if (event.completed && !includeCompleted) continue;
    let section;
    if (event.date < today) {
      if (event.completed) section = "done";
      else if (["follow_up", "deadline", "reminder"].includes(event.kind)) section = "overdue";
      else continue;                                                                    // a past meeting or date is history
    } else if (event.date === today) {
      const over = event.startTime && (event.endTime || event.startTime) < time;
      if (event.completed) section = "done";
      else if (over && event.kind === "meeting") continue;
      else if (over && event.kind === "important_date") continue;
      else section = over ? "overdue" : "today";
    } else section = event.completed ? "done" : "upcoming";
    items.push({ event, section, subtitle: agendaSubtitle(event, today) });
  }
  const rank = { overdue: 0, today: 1, upcoming: 2, done: 3 };
  return items.sort((a, b) => rank[a.section] - rank[b.section]
    || a.event.date.localeCompare(b.event.date)
    || (a.event.startTime ? 1 : 0) - (b.event.startTime ? 1 : 0)
    || (a.event.startTime || "").localeCompare(b.event.startTime || "")
    || a.event.title.localeCompare(b.event.title));
}

/** Events whose reminder time has arrived (and that have not yet finished or been completed). */
export function dueReminders(events, now) {
  return events.filter((event) => {
    if (event.completed || event.reminderMinutes == null) return false;
    const moment = eventMoment(event);
    const remindAt = new Date(moment.getTime() - event.reminderMinutes * 60_000);
    return remindAt <= now && moment.getTime() >= now.getTime() - 30 * 60_000;
  });
}

/** Map of 'YYYY-MM-DD' -> events on that day. */
export function eventsByDate(events) {
  const map = new Map();
  for (const event of events) map.set(event.date, [...(map.get(event.date) || []), event]);
  return map;
}

/** Six weeks of days (Monday first) covering the given month; month is 0-based. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  return [...Array(42)].map((_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return localDay(day); });
}
