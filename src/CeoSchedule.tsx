import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { KIND_LABELS, REMINDER_LABELS, agendaSubtitle, buildAgenda, dueReminders, eventsByDate, localDay, monthGrid, shortDate } from "../shared/agenda.mjs";
import "./ceo-schedule.css";

/* The CEO's personal calendar and agenda, in the spirit of Apple's Calendar and Reminders. One list of saved events feeds
   both cards, so adding, editing, completing or deleting an event changes the calendar and the agenda together.
   Data is private to the signed-in account (enforced by the server). */

export type CeoEvent = { id: string; kind: string; title: string; date: string; startTime: string | null; endTime: string | null; location: string; detail: string; reminderMinutes: number | null; completed: boolean; completedAt: string | null };
type Draft = { kind: string; title: string; date: string; allDay: boolean; startTime: string; endTime: string; location: string; detail: string; reminder: string };
type ModalState = null | { mode: "create"; date: string } | { mode: "view" | "edit"; event: CeoEvent } | { mode: "agenda" };
const KINDS = Object.keys(KIND_LABELS);
const REMINDERS = Object.keys(REMINDER_LABELS);
const label = (kind: string) => (KIND_LABELS as Record<string, string>)[kind] || kind;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function useCeoSchedule(flash: (message: string) => void) {
  const [events, setEvents] = useState<CeoEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [cursor, setCursor] = useState(() => { const date = new Date(); return { year: date.getFullYear(), month: date.getMonth() }; });
  const [now, setNow] = useState(() => new Date());
  const today = localDay(now);
  // One window covers the visible month grid and the agenda (recent overdue items through the next six months).
  const range = useMemo(() => {
    const grid = monthGrid(cursor.year, cursor.month);
    const back = new Date(`${today}T00:00:00`); back.setDate(back.getDate() - 90);
    const ahead = new Date(`${today}T00:00:00`); ahead.setDate(ahead.getDate() + 180);
    return { from: [grid[0], localDay(back)].sort()[0], to: [grid[41], localDay(ahead)].sort()[1] };
  }, [cursor, today]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/me/calendar?from=${range.from}&to=${range.to}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setStatus(response.status === 403 ? "unavailable" : "error"); return; }
      if (!body.available) { setEvents([]); setStatus("unavailable"); return; }
      setEvents(body.events); setStatus("ready");
    } catch { setStatus("error"); }
  }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onFocus = () => { setNow(new Date()); void load(); };
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const send = useCallback(async (path: string, method: string, body?: unknown) => {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "That could not be saved.");
    return result;
  }, []);
  // Changes show up instantly in both cards and are then confirmed by the server; if the server refuses, the change is undone.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const save = async (payload: Record<string, unknown>, id?: string) => {
    if (!id) {
      const created = await send("/api/me/calendar/events", "POST", payload);
      setEvents(current => [...current, created]);
      return created;
    }
    const snapshot = eventsRef.current;
    setEvents(current => current.map(event => event.id === id ? { ...event, ...payload, completedAt: payload.completed === undefined ? event.completedAt : payload.completed ? new Date().toISOString() : null } as CeoEvent : event));
    try {
      const updated = await send(`/api/me/calendar/events/${id}`, "PATCH", payload);
      setEvents(current => current.map(event => event.id === id ? updated : event));
      return updated;
    } catch (problem) { setEvents(snapshot); throw problem; }
  };
  const remove = async (id: string) => {
    const snapshot = eventsRef.current;
    setEvents(current => current.filter(event => event.id !== id));
    try { await send(`/api/me/calendar/events/${id}`, "DELETE"); } catch (problem) { setEvents(snapshot); throw problem; }
  };

  const agenda = useMemo(() => buildAgenda(events, now), [events, now]);
  const everything = useMemo(() => buildAgenda(events, now, { includeCompleted: true }), [events, now]);
  const reminders = useMemo(() => new Set(dueReminders(events, now).map((event: CeoEvent) => event.id)), [events, now]);
  useEffect(() => {
    for (const event of dueReminders(events, now) as CeoEvent[]) {
      const key = `ceo-reminder-${event.id}-${event.date}-${event.startTime}`;
      try { if (sessionStorage.getItem(key)) continue; sessionStorage.setItem(key, "1"); } catch { /* reminders still show in the agenda */ }
      flash(`Reminder: ${event.title}${event.startTime ? ` at ${event.startTime}` : ""}`);
    }
  }, [events, now, flash]);

  return { report: flash, events, status, cursor, setCursor, now, today, agenda, everything, reminders, save, remove, byDate: useMemo(() => eventsByDate(events), [events]) };
}
type Schedule = ReturnType<typeof useCeoSchedule>;

const Unavailable = ({ status }: { status: Schedule["status"] }) => <div className="ceo-state"><strong>{status === "error" ? "Couldn’t load" : status === "loading" ? "Loading…" : "Not available yet"}</strong><span>{status === "error" ? "Check your connection and try again." : status === "loading" ? "" : "Your calendar becomes available once the calendar update has been applied."}</span></div>;

function CalendarCard({ s, onOpen, onAdd }: { s: Schedule; onOpen: (event: CeoEvent) => void; onAdd: (date: string) => void }) {
  const [selected, setSelected] = useState(s.today);
  const grid = monthGrid(s.cursor.year, s.cursor.month);
  const step = (delta: number) => s.setCursor(({ year, month }) => { const date = new Date(year, month + delta, 1); return { year: date.getFullYear(), month: date.getMonth() }; });
  const dayEvents = s.byDate.get(selected) || [];
  return <section id="workspace-calendar" className="workspace-card ceo-card ceo-calendar" aria-label="My Calendar">
    <header className="ceo-cal-head">
      <h2 aria-label={`My Calendar, ${MONTH_NAMES[s.cursor.month]} ${s.cursor.year}`}><b>{MONTH_NAMES[s.cursor.month]}</b> <span>{s.cursor.year}</span></h2>
      <div className="ceo-cal-nav">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={19} strokeWidth={2.2} /></button>
        <button type="button" className="ceo-cal-today" onClick={() => { const d = new Date(); s.setCursor({ year: d.getFullYear(), month: d.getMonth() }); setSelected(s.today); }}>Today</button>
        <button type="button" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={19} strokeWidth={2.2} /></button>
        <button type="button" className="ceo-cal-add" aria-label="Add event" disabled={s.status !== "ready"} onClick={() => onAdd(selected)}><Plus size={20} strokeWidth={2.2} /></button>
      </div>
    </header>
    {s.status !== "ready" ? <Unavailable status={s.status} /> : <>
      <div className="ceo-cal-grid" role="grid" aria-label={`${MONTH_NAMES[s.cursor.month]} ${s.cursor.year}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={index} className="ceo-cal-weekday" aria-hidden="true">{day}</span>)}
        {grid.map(day => {
          const list = s.byDate.get(day) || [];
          const open = list.some(event => !event.completed);
          const inMonth = Number(day.slice(5, 7)) - 1 === s.cursor.month;
          return <button type="button" key={day} role="gridcell" aria-selected={day === selected} aria-label={`${shortDate(day)}${list.length ? `, ${list.length} ${list.length === 1 ? "event" : "events"}` : ""}`}
            className={`ceo-cal-day${inMonth ? "" : " out"}${day === s.today ? " today" : ""}${day === selected ? " selected" : ""}`} onClick={() => setSelected(day)}>
            <span>{Number(day.slice(8))}</span>{list.length > 0 && <i className={open ? "" : "done"} aria-hidden="true" />}
          </button>;
        })}
      </div>
      <div className="ceo-cal-day-list">
        <div className="ceo-cal-day-head"><b>{selected === s.today ? "Today" : shortDate(selected)}</b></div>
        {dayEvents.length === 0 ? <div className="ceo-empty-line">No events<button type="button" onClick={() => onAdd(selected)}>Add Event</button></div>
          : dayEvents.slice(0, 3).map(event => <button type="button" key={event.id} className={`ceo-cal-event kind-${event.kind}${event.completed ? " completed" : ""}`} onClick={() => onOpen(event)}>
            <span className="ceo-cal-event-bar" aria-hidden="true" /><span className="ceo-cal-event-time">{event.startTime || "All-day"}</span><span className="ceo-cal-event-title">{event.title}</span>{event.reminderMinutes != null && <Bell size={12} aria-label="Has an alert" />}</button>)}
        {dayEvents.length > 3 && <div className="ceo-empty-line">+{dayEvents.length - 3} more</div>}
      </div></>}
  </section>;
}

function AgendaRow({ item, s, onOpen }: { item: ReturnType<typeof buildAgenda>[number]; s: Schedule; onOpen: (event: CeoEvent) => void }) {
  const [busy, setBusy] = useState(false);
  const event = item.event as CeoEvent;
  return <div className={`ceo-agenda-item kind-${event.kind}${event.completed ? " completed" : ""}`}>
    <button type="button" className="ceo-agenda-check" aria-label={event.completed ? `Mark “${event.title}” as not done` : `Mark “${event.title}” as completed`} disabled={busy}
      onClick={async () => { setBusy(true); try { await s.save({ completed: !event.completed }, event.id); } catch (problem) { s.report(problem instanceof Error ? problem.message : "That could not be saved."); } finally { setBusy(false); } }}>{event.completed && <Check size={13} strokeWidth={3} />}</button>
    <button type="button" className="ceo-agenda-main" onClick={() => onOpen(event)}>
      <b>{event.title}</b><small className={item.section === "overdue" && !event.completed ? "overdue" : ""}>{item.section === "overdue" && !event.completed ? `Overdue · ${item.subtitle}` : item.subtitle}</small>
    </button>
    {s.reminders.has(event.id) && <Bell className="ceo-agenda-bell" size={14} aria-label="Reminder is due" />}
  </div>;
}

function AgendaCard({ s, onOpen, onViewAll }: { s: Schedule; onOpen: (event: CeoEvent) => void; onViewAll: () => void }) {
  const items = s.agenda.slice(0, 3);
  return <section id="workspace-agenda" className="workspace-card ceo-card ceo-agenda" aria-label="Your Agenda">
    <header className="ceo-agenda-head"><h2>Your Agenda</h2><button type="button" className="ceo-link" onClick={onViewAll} disabled={s.status !== "ready"}>View all <ChevronRight size={14} strokeWidth={2.4} /></button></header>
    {s.status !== "ready" ? <Unavailable status={s.status} />
      : items.length === 0 ? <div className="ceo-state"><strong>All clear</strong><span>Meetings, follow-ups, deadlines and reminders you add to your calendar will appear here.</span></div>
      : <div className="ceo-agenda-list">{items.map(item => <AgendaRow key={item.event.id} item={item} s={s} onOpen={onOpen} />)}</div>}
  </section>;
}

function toDraft(event?: CeoEvent, date?: string): Draft {
  return { kind: event?.kind || "meeting", title: event?.title || "", date: event?.date || date || localDay(new Date()), allDay: event ? !event.startTime : false, startTime: event?.startTime || "09:00", endTime: event?.endTime || "", location: event?.location || "", detail: event?.detail || "", reminder: event?.reminderMinutes == null ? "" : String(event.reminderMinutes) };
}

/** An iOS-style sheet: Cancel on the left, the title in the middle, the primary action on the right. */
function Sheet({ title, left, right, children }: { title: string; left: { label: string; onClick: () => void; disabled?: boolean }; right?: { label: string; onClick: () => void; disabled?: boolean }; children: React.ReactNode }) {
  return <div className="modal-back" onMouseDown={event => { if (event.target === event.currentTarget) left.onClick(); }}>
    <div className="modal ceo-sheet" role="dialog" aria-label={title}>
      <div className="ceo-sheet-bar">
        <button type="button" className="ceo-sheet-btn" onClick={left.onClick} disabled={left.disabled}>{left.label}</button>
        <b>{title}</b>
        {right ? <button type="button" className="ceo-sheet-btn strong" onClick={right.onClick} disabled={right.disabled}>{right.label}</button> : <span className="ceo-sheet-btn" aria-hidden="true" />}
      </div>
      <div className="ceo-sheet-body">{children}</div>
    </div>
  </div>;
}

function EventModal({ state, s, onClose, setState }: { state: Exclude<ModalState, null | { mode: "agenda" }>; s: Schedule; onClose: () => void; setState: (state: ModalState) => void }) {
  const existing = state.mode === "create" ? undefined : state.event;
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing, state.mode === "create" ? state.date : undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const run = async (work: () => Promise<unknown>, after: () => void) => { setBusy(true); setError(""); try { await work(); after(); } catch (problem) { setError(problem instanceof Error ? problem.message : "That could not be saved."); setBusy(false); } };

  if (state.mode === "view" && existing) {
    return <Sheet title="Event" left={{ label: "Close", onClick: onClose }} right={{ label: "Edit", onClick: () => setState({ mode: "edit", event: existing }) }}>
      <div className={`ceo-view-hero kind-${existing.kind}`}><span className="ceo-kind-dot" aria-hidden="true" /><div><h3>{existing.title}</h3><p>{shortDate(existing.date)}{existing.startTime ? ` · ${existing.startTime}${existing.endTime ? `–${existing.endTime}` : ""}` : " · All-day"}</p></div></div>
      <div className="ceo-group ceo-details">
        <div className="ceo-row"><span>Type</span><b>{label(existing.kind)}</b></div>
        {existing.location && <div className="ceo-row"><span>Location</span><b>{existing.location}</b></div>}
        {existing.detail && <div className="ceo-row"><span>Notes</span><b>{existing.detail}</b></div>}
        <div className="ceo-row"><span>Alert</span><b>{existing.reminderMinutes == null ? "None" : (REMINDER_LABELS as Record<string, string>)[existing.reminderMinutes]}</b></div>
        <div className="ceo-row"><span>Status</span><b>{existing.completed ? "Completed" : agendaSubtitle(existing, s.today) || "Open"}</b></div>
      </div>
      <div className="ceo-group"><button type="button" className="ceo-action" disabled={busy} onClick={() => { onClose(); void s.save({ completed: !existing.completed }, existing.id).catch(problem => s.report(problem instanceof Error ? problem.message : "That could not be saved.")); }}>{existing.completed ? "Mark as Not Done" : "Mark as Completed"}</button></div>
      <div className="ceo-group"><button type="button" className="ceo-action danger" disabled={busy} onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } onClose(); void s.remove(existing.id).catch(problem => s.report(problem instanceof Error ? problem.message : "That could not be deleted.")); }}>{confirmDelete ? "Tap again to delete" : "Delete Event"}</button></div>
      {error && <div className="ceo-error" role="alert">{error}</div>}
    </Sheet>;
  }

  const payload = () => ({
    kind: draft.kind, title: draft.title, date: draft.date,
    startTime: draft.allDay ? null : draft.startTime || null, endTime: draft.allDay ? null : draft.endTime || null,
    location: draft.location, detail: draft.detail, reminderMinutes: draft.reminder === "" ? null : Number(draft.reminder),
  });
  return <Sheet title={existing ? "Edit Event" : "New Event"} left={{ label: "Cancel", onClick: existing ? () => setState({ mode: "view", event: existing }) : onClose, disabled: busy }}
    right={{ label: busy ? "Saving…" : existing ? "Done" : "Add", onClick: () => void run(() => s.save(payload(), existing?.id), onClose), disabled: busy || draft.title.trim().length < 2 || !draft.date }}>
    <div className="ceo-group">
      <input className="ceo-input" autoFocus aria-label="Title" placeholder="Title" value={draft.title} maxLength={160} onChange={event => set({ title: event.target.value })} />
      <input className="ceo-input" aria-label="Location" placeholder="Location" value={draft.location} maxLength={160} onChange={event => set({ location: event.target.value })} />
    </div>
    <div className="ceo-group">
      <label className="ceo-row"><span>Type</span><select value={draft.kind} onChange={event => set({ kind: event.target.value })}>{KINDS.map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
      <label className="ceo-row"><span>All-day</span><input className="ceo-switch" type="checkbox" role="switch" checked={draft.allDay} onChange={event => set({ allDay: event.target.checked, reminder: event.target.checked && ["5", "15", "30", "60"].includes(draft.reminder) ? "" : draft.reminder })} /></label>
      <label className="ceo-row"><span>Date</span><input type="date" value={draft.date} onChange={event => set({ date: event.target.value })} /></label>
      {!draft.allDay && <><label className="ceo-row"><span>Starts</span><input type="time" value={draft.startTime} onChange={event => set({ startTime: event.target.value })} /></label>
        <label className="ceo-row"><span>Ends</span><input type="time" value={draft.endTime} onChange={event => set({ endTime: event.target.value })} /></label></>}
    </div>
    <div className="ceo-group">
      <label className="ceo-row"><span>Alert</span><select value={draft.reminder} onChange={event => set({ reminder: event.target.value })}><option value="">None</option>{REMINDERS.filter(key => !draft.allDay || ["0", "1440"].includes(key)).map(key => <option key={key} value={key}>{(REMINDER_LABELS as Record<string, string>)[key]}</option>)}</select></label>
      <input className="ceo-input" aria-label="Notes" placeholder="Notes (shown on your agenda)" value={draft.detail} maxLength={500} onChange={event => set({ detail: event.target.value })} />
    </div>
    {error && <div className="ceo-error" role="alert">{error}</div>}
  </Sheet>;
}

function AgendaModal({ s, onClose, onOpen }: { s: Schedule; onClose: () => void; onOpen: (event: CeoEvent) => void }) {
  const [showDone, setShowDone] = useState(false);
  const items = s.everything.filter(item => showDone || item.section !== "done");
  const sections: [string, string][] = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Coming Up"], ["done", "Completed"]];
  return <Sheet title="Agenda" left={{ label: showDone ? "Hide Completed" : "Show Completed", onClick: () => setShowDone(value => !value) }} right={{ label: "Done", onClick: onClose }}>
    {items.length === 0 ? <div className="ceo-state"><strong>All clear</strong><span>Nothing is waiting for you.</span></div>
      : sections.map(([key, title]) => { const group = items.filter(item => item.section === key); return group.length ? <div key={key} className="ceo-agenda-group"><h4>{title}</h4><div className="ceo-group">{group.map(item => <AgendaRow key={item.event.id} item={item} s={s} onOpen={event => { onClose(); onOpen(event); }} />)}</div></div> : null; })}
  </Sheet>;
}

/** Replaces the Tasks card on the CEO dashboard: My Calendar on the left, Your Agenda on the right. */
export function CeoSchedule({ flash }: { flash: (message: string) => void }) {
  const s = useCeoSchedule(flash);
  const [modal, setModal] = useState<ModalState>(null);
  return <div className="ceo-schedule">
    <CalendarCard s={s} onOpen={event => setModal({ mode: "view", event })} onAdd={date => setModal({ mode: "create", date })} />
    <AgendaCard s={s} onOpen={event => setModal({ mode: "view", event })} onViewAll={() => setModal({ mode: "agenda" })} />
    {modal?.mode === "agenda" && <AgendaModal s={s} onClose={() => setModal(null)} onOpen={event => setModal({ mode: "view", event })} />}
    {modal && modal.mode !== "agenda" && <EventModal key={modal.mode === "create" ? `new-${modal.date}` : `${modal.mode}-${modal.event.id}`} state={modal} s={s} onClose={() => setModal(null)} setState={setModal} />}
  </div>;
}
