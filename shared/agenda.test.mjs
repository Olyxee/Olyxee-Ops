import assert from "node:assert/strict";
import test from "node:test";
import { agendaSubtitle, buildAgenda, dueReminders, eventsByDate, monthGrid, whenLabel } from "./agenda.mjs";

const NOW = new Date("2026-11-10T10:00:00");           // Tuesday, 10:00 local
let n = 0;
const event = (over = {}) => ({ id: `e${++n}`, kind: "meeting", title: `Event ${n}`, date: "2026-11-10", startTime: null, endTime: null, location: "", detail: "", reminderMinutes: null, completed: false, ...over });

test("the agenda has only what still needs the CEO: no past meetings, no completed items", () => {
  const events = [
    event({ id: "past-meeting", date: "2026-11-09", startTime: "09:00" }),
    event({ id: "earlier-today", startTime: "08:00", endTime: "09:00" }),
    event({ id: "done", kind: "follow_up", date: "2026-11-09", completed: true }),
    event({ id: "next-meeting", startTime: "14:00" }),
  ];
  assert.deepEqual(buildAgenda(events, NOW).map((item) => item.event.id), ["next-meeting"]);
});

test("order: overdue open items first, then today, then later, earliest first, all-day before timed", () => {
  const events = [
    event({ id: "later", date: "2026-11-20", startTime: "09:00" }),
    event({ id: "tomorrow", date: "2026-11-11" }),
    event({ id: "today-timed", startTime: "15:00" }),
    event({ id: "today-allday", kind: "deadline" }),
    event({ id: "overdue-followup", kind: "follow_up", date: "2026-11-03" }),
    event({ id: "overdue-deadline", kind: "deadline", date: "2026-11-08" }),
  ];
  const items = buildAgenda(events, NOW);
  assert.deepEqual(items.map((item) => item.event.id), ["overdue-followup", "overdue-deadline", "today-allday", "today-timed", "tomorrow", "later"]);
  assert.deepEqual(items.map((item) => item.section), ["overdue", "overdue", "today", "today", "upcoming", "upcoming"]);
});

test("a follow-up or deadline earlier today that is still open becomes overdue; a finished meeting does not", () => {
  const items = buildAgenda([event({ id: "f", kind: "follow_up", startTime: "08:00" }), event({ id: "m", kind: "meeting", startTime: "08:00", endTime: "09:00" })], NOW);
  assert.deepEqual(items.map((item) => [item.event.id, item.section]), [["f", "overdue"]]);
});

test("subtitles use the person's own note, with sensible defaults and no invented details", () => {
  assert.equal(agendaSubtitle(event({ startTime: "09:00", location: "Internal" }), "2026-11-10"), "09:00 · Internal");
  assert.equal(agendaSubtitle(event({ startTime: "09:00" }), "2026-11-10"), "09:00");                       // no location: nothing made up
  assert.equal(agendaSubtitle(event({ startTime: "09:00", endTime: "10:30", date: "2026-11-11" }), "2026-11-10"), "Tomorrow · 09:00–10:30");
  assert.equal(agendaSubtitle(event({ kind: "follow_up" }), "2026-11-10"), "Awaiting your response");
  assert.equal(agendaSubtitle(event({ kind: "follow_up", detail: "Enterprise client" }), "2026-11-10"), "Enterprise client");
  assert.equal(agendaSubtitle(event({ kind: "deadline", detail: "Decision required" }), "2026-11-10"), "Decision required");
  assert.equal(agendaSubtitle(event({ kind: "deadline", date: "2026-11-14" }), "2026-11-10"), "Due Sat 14 Nov");
  assert.equal(agendaSubtitle(event({ kind: "deadline" }), "2026-11-10"), "Due today");
});

test("changes show up immediately: adding, completing and removing events changes the agenda", () => {
  let events = [event({ id: "a", kind: "follow_up", date: "2026-11-12" })];
  assert.equal(buildAgenda(events, NOW).length, 1);
  events = [...events, event({ id: "b", kind: "deadline", date: "2026-11-11" })];
  assert.deepEqual(buildAgenda(events, NOW).map((item) => item.event.id), ["b", "a"]);
  events = events.map((e) => (e.id === "b" ? { ...e, completed: true } : e));
  assert.deepEqual(buildAgenda(events, NOW).map((item) => item.event.id), ["a"]);
  assert.deepEqual(buildAgenda(events, NOW, { includeCompleted: true }).map((item) => item.event.id), ["a", "b"]);   // View all can show done items last
  assert.deepEqual(buildAgenda(events.filter((e) => e.id !== "a"), NOW), []);
});

test("reminders become due at the chosen time and stop once the event is over or completed", () => {
  const meeting = event({ id: "r", startTime: "10:30", reminderMinutes: 30 });
  assert.equal(dueReminders([meeting], new Date("2026-11-10T09:59:00")).length, 0);
  assert.equal(dueReminders([meeting], new Date("2026-11-10T10:00:00")).length, 1);
  assert.equal(dueReminders([{ ...meeting, completed: true }], NOW).length, 0);
  assert.equal(dueReminders([{ ...meeting, reminderMinutes: null }], NOW).length, 0);
  assert.equal(dueReminders([meeting], new Date("2026-11-10T13:00:00")).length, 0);
  assert.equal(dueReminders([event({ date: "2026-11-11", reminderMinutes: 1440 })], NOW).length, 1);                // all-day: the day before at 09:00
});

test("the month grid starts on Monday, covers six weeks, and groups events by date", () => {
  const grid = monthGrid(2026, 10);                                                                                 // November 2026
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-10-26");
  assert.ok(grid.includes("2026-11-30"));
  const byDate = eventsByDate([event({ date: "2026-11-10" }), event({ date: "2026-11-10" }), event({ date: "2026-11-12" })]);
  assert.equal(byDate.get("2026-11-10").length, 2);
  assert.equal(whenLabel("2026-11-10", "2026-11-10"), "Today");
  assert.equal(whenLabel("2026-11-12", "2026-11-10"), "Thu 12 Nov");
});
