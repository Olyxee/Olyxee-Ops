import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { KIND_LABELS, REMINDER_LABELS, agendaSubtitle, buildAgenda, dueReminders, eventsByDate, localDay, monthGrid, shortDate } from "../shared/agenda.mjs";
import "./ceo-schedule.css";

/* The CEO's personal calendar and agenda. One list of saved events feeds both cards, so adding, editing, completing or
   deleting an event changes the calendar and the agenda together. Data is private to the signed-in account (server-enforced). */

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
    await load();                                                                       // both cards re-read the same data
    return result;
  }, [load]);
  const save = (payload: Record<string, unknown>, id?: string) => send(id ? `/api/me/calendar/events/${id}` : "/api/me/calendar/events", id ? "PATCH" : "POST", payload);
  const remove = (id: string) => send(`/api/me/calendar/events/${id}`, "DELETE");

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

  return { events, status, cursor, setCursor, now, today, agenda, everything, reminders, save, remove, byDate: useMemo(() => eventsByDate(events), [events]) };
}
type Schedule = ReturnType<typeof useCeoSchedule>;

const Unavailable = ({ status }: { status: Schedule["status"] }) => <div className="empty"><strong>{status === "error" ? "Could not load" : status === "loading" ? "Loading…" : "Not set up yet"}</strong>{status === "error" ? "Check your connection and try again." : status === "loading" ? "" : "Your calendar becomes available once the calendar update has been applied."}</div>;

function CalendarCard({ s, onOpen, onAdd }: { s: Schedule; onOpen: (event: CeoEvent) => void; onAdd: (date: string) => void }) {
  const [selected, setSelected] = useState(s.today);
  const grid = monthGrid(s.cursor.year, s.cursor.month);
  const step = (delta: number) => s.setCursor(({ year, month }) => { const date = new Date(year, month + delta, 1); return { year: date.getFullYear(), month: date.getMonth() }; });
  const dayEvents = s.byDate.get(selected) || [];
  return <section id="workspace-calendar" className="workspace-card ceo-calendar" aria-label="My Calendar">
    <div className="workspace-card-head"><div><span className="workspace-icon blue"><CalendarDays size={17} /></span><span><b>My Calendar</b><small>{MONTH_NAMES[s.cursor.month]} {s.cursor.year}</small></span></div>
      <span className="workspace-head-actions">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={14} /></button>
        <button type="button" onClick={() => { const d = new Date(); s.setCursor({ year: d.getFullYear(), month: d.getMonth() }); setSelected(s.today); }}>Today</button>
        <button type="button" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={14} /></button>
        <button type="button" aria-label="Add event" disabled={s.status !== "ready"} onClick={() => onAdd(selected)}><Plus size={14} /></button>
      </span></div>
    {s.status !== "ready" ? <Unavailable status={s.status} /> : <>
      <div className="ceo-cal-grid" role="grid" aria-label={`${MONTH_NAMES[s.cursor.month]} ${s.cursor.year}`}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={index} className="ceo-cal-weekday" aria-hidden="true">{day}</span>)}
        {grid.map(day => {
          const count = (s.byDate.get(day) || []).filter(event => !event.completed).length;
          const total = (s.byDate.get(day) || []).length;
          const inMonth = Number(day.slice(5, 7)) - 1 === s.cursor.month;
          return <button type="button" key={day} role="gridcell" aria-selected={day === selected} aria-label={`${shortDate(day)}${total ? `, ${total} ${total === 1 ? "event" : "events"}` : ""}`}
            className={`ceo-cal-day${inMonth ? "" : " out"}${day === s.today ? " today" : ""}${day === selected ? " selected" : ""}${total ? " has-events" : ""}`} onClick={() => setSelected(day)}>
            <span>{Number(day.slice(8))}</span>{total > 0 && <i className={count ? "" : "done"} aria-hidden="true" />}
          </button>;
        })}
      </div>
      <div className="ceo-cal-day-list">
        <div className="ceo-cal-day-head"><b>{selected === s.today ? "Today" : shortDate(selected)}</b><span>{dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}` : ""}</span></div>
        {dayEvents.length === 0 ? <div className="ceo-empty-line">No events. <button type="button" onClick={() => onAdd(selected)}>Add one</button></div>
          : dayEvents.slice(0, 3).map(event => <button type="button" key={event.id} className={`ceo-cal-event kind-${event.kind}${event.completed ? " completed" : ""}`} onClick={() => onOpen(event)}>
            <span className="ceo-cal-event-time">{event.startTime || "All day"}</span><span className="ceo-cal-event-title">{event.title}</span>{event.reminderMinutes != null && <Bell size={11} aria-label="Has a reminder" />}</button>)}
        {dayEvents.length > 3 && <div className="ceo-empty-line">+{dayEvents.length - 3} more on this day</div>}
      </div></>}
  </section>;
}

function AgendaRow({ item, s, onOpen }: { item: ReturnType<typeof buildAgenda>[number]; s: Schedule; onOpen: (event: CeoEvent) => void }) {
  const [busy, setBusy] = useState(false);
  const event = item.event as CeoEvent;
  return <div className={`ceo-agenda-item${event.completed ? " completed" : ""}`}>
    <button type="button" className="ceo-agenda-check" aria-label={event.completed ? `Mark “${event.title}” as not done` : `Mark “${event.title}” as completed`} disabled={busy}
      onClick={async () => { setBusy(true); try { await s.save({ completed: !event.completed }, event.id); } finally { setBusy(false); } }}>{event.completed && <Check size={12} />}</button>
    <button type="button" className="ceo-agenda-main" onClick={() => onOpen(event)}><b>{event.title}</b><small>{item.subtitle}</small></button>
    {item.section === "overdue" && !event.completed && <span className="badge red">Overdue</span>}
    {s.reminders.has(event.id) && <span className="badge amber"><Bell size={10} /> Reminder</span>}
  </div>;
}

function AgendaCard({ s, onOpen, onViewAll }: { s: Schedule; onOpen: (event: CeoEvent) => void; onViewAll: () => void }) {
  const items = s.agenda.slice(0, 3);
  return <section id="workspace-agenda" className="workspace-card ceo-agenda" aria-label="Your Agenda">
    <div className="workspace-card-head"><div><span className="workspace-icon violet"><CalendarCheck size={17} /></span><span><b>Your Agenda</b><small>{s.status === "ready" ? (s.agenda.length ? `${s.agenda.length} open` : "Nothing pending") : ""}</small></span></div>
      <span className="workspace-head-actions"><button type="button" onClick={onViewAll} disabled={s.status !== "ready"}>View all <ChevronRight size={13} /></button></span></div>
    {s.status !== "ready" ? <Unavailable status={s.status} />
      : items.length === 0 ? <div className="empty"><strong>Your agenda is clear</strong>Meetings, follow-ups, deadlines and reminders you add to your calendar appear here.</div>
      : <div className="ceo-agenda-list">{items.map(item => <AgendaRow key={item.event.id} item={item} s={s} onOpen={onOpen} />)}</div>}
  </section>;
}

function toDraft(event?: CeoEvent, date?: string): Draft {
  return { kind: event?.kind || "meeting", title: event?.title || "", date: event?.date || date || localDay(new Date()), allDay: event ? !event.startTime : false, startTime: event?.startTime || "09:00", endTime: event?.endTime || "", location: event?.location || "", detail: event?.detail || "", reminder: event?.reminderMinutes == null ? "" : String(event.reminderMinutes) };
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
    return <Shell title={existing.title} onClose={onClose} footer={<>
      {confirmDelete ? <><button className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button><button className="btn danger" disabled={busy} onClick={() => void run(() => s.remove(existing.id), onClose)}>Delete event</button></>
        : <><button className="btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> Delete</button><button className="btn" onClick={() => setState({ mode: "edit", event: existing })}><Pencil size={13} /> Edit</button>
          <button className="btn primary" disabled={busy} onClick={() => void run(() => s.save({ completed: !existing.completed }, existing.id), onClose)}>{existing.completed ? "Mark as not done" : "Mark completed"}</button></>}</>}>
      <dl className="ceo-event-details">
        <div><dt>Type</dt><dd>{label(existing.kind)}</dd></div>
        <div><dt>When</dt><dd>{shortDate(existing.date)}{existing.startTime ? ` · ${existing.startTime}${existing.endTime ? `–${existing.endTime}` : ""}` : " · All day"}</dd></div>
        {existing.location && <div><dt>Where</dt><dd>{existing.location}</dd></div>}
        {existing.detail && <div><dt>Notes</dt><dd>{existing.detail}</dd></div>}
        <div><dt>Reminder</dt><dd>{existing.reminderMinutes == null ? "None" : (REMINDER_LABELS as Record<string, string>)[existing.reminderMinutes]}</dd></div>
        <div><dt>Status</dt><dd>{existing.completed ? "Completed" : agendaSubtitle(existing, s.today) || "Open"}</dd></div>
      </dl>
      {error && <div className="person-field-error" role="alert">{error}</div>}
    </Shell>;
  }

  const payload = () => ({
    kind: draft.kind, title: draft.title, date: draft.date,
    startTime: draft.allDay ? null : draft.startTime || null, endTime: draft.allDay ? null : draft.endTime || null,
    location: draft.location, detail: draft.detail, reminderMinutes: draft.reminder === "" ? null : Number(draft.reminder),
  });
  return <Shell title={existing ? "Edit event" : "Add event"} onClose={onClose} footer={<>
    <button className="btn" onClick={existing ? () => setState({ mode: "view", event: existing }) : onClose} disabled={busy}>Cancel</button>
    <button className="btn primary" disabled={busy || draft.title.trim().length < 2 || !draft.date} onClick={() => void run(() => s.save(payload(), existing?.id), onClose)}>{busy ? "Saving…" : "Save"}</button></>}>
    <div className="form-grid">
      <label className="form-label">Title<input className="input" autoFocus value={draft.title} maxLength={160} onChange={event => set({ title: event.target.value })} placeholder="e.g. Follow up with the enterprise client" /></label>
      <label className="form-label">Type<select className="select" value={draft.kind} onChange={event => set({ kind: event.target.value })}>{KINDS.map(kind => <option key={kind} value={kind}>{label(kind)}</option>)}</select></label>
      <label className="form-label">Date<input className="input" type="date" value={draft.date} onChange={event => set({ date: event.target.value })} /></label>
      <label className="org-check"><input type="checkbox" checked={draft.allDay} onChange={event => set({ allDay: event.target.checked, reminder: event.target.checked && ["5", "15", "30", "60"].includes(draft.reminder) ? "" : draft.reminder })} /> All day</label>
      {!draft.allDay && <div className="ceo-time-row"><label className="form-label">Starts<input className="input" type="time" value={draft.startTime} onChange={event => set({ startTime: event.target.value })} /></label>
        <label className="form-label">Ends <span className="muted">(optional)</span><input className="input" type="time" value={draft.endTime} onChange={event => set({ endTime: event.target.value })} /></label></div>}
      <label className="form-label">Location <span className="muted">(optional)</span><input className="input" value={draft.location} maxLength={160} onChange={event => set({ location: event.target.value })} placeholder="e.g. Internal, Teams, client office" /></label>
      <label className="form-label">Note <span className="muted">(optional, shown on your agenda)</span><input className="input" value={draft.detail} maxLength={500} onChange={event => set({ detail: event.target.value })} placeholder="e.g. Decision required" /></label>
      <label className="form-label">Reminder <span className="muted">(optional)</span><select className="select" value={draft.reminder} onChange={event => set({ reminder: event.target.value })}><option value="">No reminder</option>{REMINDERS.filter(key => !draft.allDay || ["0", "1440"].includes(key)).map(key => <option key={key} value={key}>{(REMINDER_LABELS as Record<string, string>)[key]}</option>)}</select></label>
      {error && <div className="person-field-error" role="alert">{error}</div>}
    </div>
  </Shell>;
}

function AgendaModal({ s, onClose, onOpen }: { s: Schedule; onClose: () => void; onOpen: (event: CeoEvent) => void }) {
  const [showDone, setShowDone] = useState(false);
  const items = s.everything.filter(item => showDone || item.section !== "done");
  const sections: [string, string][] = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Coming up"], ["done", "Completed"]];
  return <Shell title="Your agenda" onClose={onClose} footer={<><label className="org-check"><input type="checkbox" checked={showDone} onChange={event => setShowDone(event.target.checked)} /> Show completed</label><button className="btn" onClick={onClose}>Close</button></>}>
    {items.length === 0 ? <div className="empty"><strong>Your agenda is clear</strong>Nothing is waiting for you.</div>
      : sections.map(([key, title]) => { const group = items.filter(item => item.section === key); return group.length ? <div key={key} className="ceo-agenda-group"><h4>{title} <span>{group.length}</span></h4>{group.map(item => <AgendaRow key={item.event.id} item={item} s={s} onOpen={event => { onClose(); onOpen(event); }} />)}</div> : null; })}
  </Shell>;
}

function Shell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return <div className="modal-back" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal ceo-modal" role="dialog" aria-label={title}>
      <div className="modal-head"><b>{title}</b><button className="close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">{footer}</div>
    </div>
  </div>;
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
