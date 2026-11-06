import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import "./org.css";

type Capability = { capability: string; scopeDepartmentId: string | null };
export type OrgAccess = {
  loaded: boolean; enabled: boolean; capabilities: Capability[]; version: number;
  can: (capability: string) => boolean; canView: boolean; refresh: () => Promise<void>;
};
type OrgNode = {
  ref: string; name: string; employmentType: string; active: boolean; status: string; title: string | null;
  departmentId: string | null; department: string | null; reportsTo: string | null; internSupervisor: string | null;
  functionalLeads: string[]; directReports: string[]; supervisedInterns: string[]; functionalReports: string[]; leadsDepartments: string[];
};
type Chart = {
  nodes: Record<string, OrgNode>; roots: string[]; departments: { id: string; name: string }[];
  issues: { code: string; ref: string; message: string }[]; counts: { people: number; employees: number; interns: number };
  version: number; asOf: string | null;
};
type Flash = (message: string) => void;

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

export function useOrgAccess(signedIn: boolean): OrgAccess {
  const [state, setState] = useState<{ loaded: boolean; enabled: boolean; capabilities: Capability[]; version: number }>({ loaded: false, enabled: false, capabilities: [], version: 0 });
  const refresh = useCallback(async () => {
    try {
      const result = await api("/api/org/me");
      if (result.ok) setState({ loaded: true, enabled: Boolean(result.body.enabled), capabilities: result.body.capabilities || [], version: result.body.version || 0 });
      else setState(current => ({ ...current, loaded: true }));
    } catch { setState(current => ({ ...current, loaded: true })); }
  }, []);
  useEffect(() => { if (signedIn) void refresh(); }, [signedIn, refresh]);
  const can = (capability: string) => state.capabilities.some(item => item.capability === capability);
  const canView = state.enabled && ["org.view_all", "org.propose", "org.approve", "org.delegate"].some(can);
  return { ...state, can, canView, refresh };
}

const CAPABILITY_LABELS: Record<string, string> = {
  "org.view_all": "View the full organisation",
  "org.propose": "Propose changes",
  "org.approve": "Approve organisational changes",
  "org.delegate": "Delegate organisational authority",
  "intern.administer": "Internship administration",
  "delivery.view": "Review delivery",
};

const departmentName = (chart: Chart | null, id: string | null | undefined) => (id ? chart?.departments.find(item => item.id === id)?.name || "Unknown department" : "Unassigned");
const nameOf = (chart: Chart | null, ref: string | null | undefined) => (ref ? chart?.nodes[ref]?.name || ref : "none");

function describeChange(entry: any, chart: Chart | null) {
  const lines: string[] = [];
  const before = entry.before || {}, after = entry.after || {};
  if (entry.kind === "person.added") return [`Added as ${after.title || "new team member"}`];
  if (entry.kind === "person.removed") return ["Removed from the directory"];
  if (entry.kind === "migration.seed") return ["Initial organisation records created from existing staff data"];
  if (entry.kind?.startsWith("capability.")) return [`${entry.kind.endsWith("grant") ? "Granted" : "Revoked"}: ${CAPABILITY_LABELS[after.capability] || after.capability}`];
  if ("title" in after && before.title !== after.title) lines.push(`Title: ${before.title ?? "none"} → ${after.title}`);
  if ("departmentId" in after && before.departmentId !== after.departmentId) lines.push(`Department: ${departmentName(chart, before.departmentId)} → ${departmentName(chart, after.departmentId)}`);
  if ("reportsTo" in after) lines.push(`Reports to: ${nameOf(chart, before.reportsTo)} → ${nameOf(chart, after.reportsTo)}`);
  if ("internSupervisor" in after) lines.push(`Intern supervisor: ${nameOf(chart, before.internSupervisor)} → ${nameOf(chart, after.internSupervisor)}`);
  if ("functionalLeads" in after) lines.push(`Functional leads: ${(after.functionalLeads || []).map((ref: string) => nameOf(chart, ref)).join(", ") || "none"}`);
  if ("leadOf" in after) lines.push(`Leads: ${(after.leadOf || []).map((id: string) => departmentName(chart, id)).join(", ") || "no departments"}`);
  return lines.length ? lines : ["Updated"];
}

function describeProposal(payload: any, chart: Chart | null) {
  const parts: string[] = [];
  if (payload.title !== undefined) parts.push(`title “${payload.title}”`);
  if (payload.departmentId !== undefined) parts.push(`department ${departmentName(chart, payload.departmentId)}`);
  if (payload.reportsTo !== undefined) parts.push(`reports to ${nameOf(chart, payload.reportsTo)}`);
  if (payload.internSupervisor !== undefined) parts.push(`intern supervisor ${nameOf(chart, payload.internSupervisor)}`);
  if (payload.leadOfAdd?.length) parts.push(`leads ${payload.leadOfAdd.map((id: string) => departmentName(chart, id)).join(", ")}`);
  if (payload.leadOfRemove?.length) parts.push(`stops leading ${payload.leadOfRemove.map((id: string) => departmentName(chart, id)).join(", ")}`);
  return `${nameOf(chart, payload.subjectRef)}: ${parts.join("; ") || "change"}`;
}

/* ------------------------------ Change Role ------------------------------ */

export function ChangeRoleModal({ personRef, org, onClose, onDone }: { personRef: string; org: OrgAccess; onClose: () => void; onDone: (message: string) => void }) {
  const mode: "apply" | "propose" = org.can("org.approve") ? "apply" : "propose";
  const [chart, setChart] = useState<Chart | null>(null);
  const [positions, setPositions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [reportsTo, setReportsTo] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [leads, setLeads] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{ summary: string[]; version: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [chartResult, positionResult] = await Promise.all([api("/api/org/chart"), api("/api/org/positions")]);
      if (!chartResult.ok) { setError(chartResult.body.error || "Could not load the organisation."); return; }
      const loaded = chartResult.body as Chart;
      const node = loaded.nodes[personRef];
      setChart(loaded);
      setPositions((positionResult.body.positions || []).map((item: any) => item.title));
      if (node) {
        setTitle(node.title && node.title !== "Title not set" ? node.title : "");
        setDepartmentId(node.departmentId || "");
        setReportsTo(node.reportsTo || "");
        setSupervisor(node.internSupervisor || "");
        setLeads(node.leadsDepartments);
      }
    })();
  }, [personRef]);

  const subject = chart?.nodes[personRef];
  const isIntern = subject?.employmentType === "Intern";
  const eligible = useMemo(() => Object.values(chart?.nodes || {}).filter(node => node.employmentType !== "Intern" && node.active && node.ref !== personRef).sort((a, b) => a.name.localeCompare(b.name)), [chart, personRef]);

  const buildInput = () => {
    if (!subject) return null;
    const input: Record<string, unknown> = { subjectRef: personRef, reason };
    const cleanTitle = title.trim();
    if (cleanTitle && cleanTitle !== subject.title) input.title = cleanTitle;
    if ((departmentId || null) !== subject.departmentId) input.departmentId = departmentId || null;
    if (!isIntern && (reportsTo || null) !== subject.reportsTo) input.reportsTo = reportsTo || null;
    if (isIntern && (supervisor || null) !== subject.internSupervisor) input.internSupervisor = supervisor || null;
    const add = leads.filter(id => !subject.leadsDepartments.includes(id));
    const remove = subject.leadsDepartments.filter(id => !leads.includes(id));
    if (add.length) input.leadOfAdd = add;
    if (remove.length) input.leadOfRemove = remove;
    return input;
  };

  const goReview = async () => {
    setError("");
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    const result = await api("/api/org/changes/preview", { method: "POST", body: JSON.stringify({ input }) });
    setBusy(false);
    if (!result.ok) { setError(result.body.error || "This change is not valid."); return; }
    setReview({ summary: result.body.summary, version: result.body.version });
    setStep("review");
  };

  const confirm = async () => {
    const input = buildInput();
    if (!input || !review) return;
    setBusy(true);
    setError("");
    const result = mode === "apply"
      ? await api("/api/org/changes", { method: "POST", body: JSON.stringify({ input, expectedVersion: review.version }) })
      : await api("/api/org/proposals", { method: "POST", body: JSON.stringify({ input }) });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error || "The change could not be saved.");
      if (result.body.code === "stale") setStep("edit");
      return;
    }
    await org.refresh();
    onDone(mode === "apply" ? "Role updated. Everyone affected has been notified." : "Proposal sent for approval.");
  };

  return <div className="modal-back" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal org-modal" role="dialog" aria-label="Change role">
      <div className="modal-head"><b>{mode === "apply" ? "Change role" : "Propose a role change"}{subject ? ` · ${subject.name}` : ""}</b><button className="close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="modal-body">
        {!chart && !error && <div className="muted">Loading…</div>}
        {!subject && chart && <div className="empty"><strong>This person is not in the organisation chart</strong>They may be hidden or inactive.</div>}
        {subject && step === "edit" && <div className="form-grid">
          <label className="form-label">Job title
            <input className="input" list="org-positions" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="e.g. VP of Engineering" />
            <datalist id="org-positions">{positions.map(item => <option key={item} value={item} />)}</datalist>
          </label>
          <label className="form-label">Department
            <select className="select" value={departmentId} onChange={event => setDepartmentId(event.target.value)}>
              <option value="">Unassigned</option>{chart!.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {!isIntern && <label className="form-label">Reports to
            <select className="select" value={reportsTo} onChange={event => setReportsTo(event.target.value)}>
              <option value="">No reporting manager</option>{eligible.map(item => <option key={item.ref} value={item.ref}>{item.name}{item.title && item.title !== "Title not set" ? ` · ${item.title}` : ""}</option>)}
            </select>
          </label>}
          {isIntern && <label className="form-label">Internship supervisor
            <select className="select" value={supervisor} onChange={event => setSupervisor(event.target.value)}>
              <option value="">No supervisor</option>{eligible.map(item => <option key={item.ref} value={item.ref}>{item.name}</option>)}
            </select>
          </label>}
          {!isIntern && <fieldset className="org-leads"><legend>Leads department</legend>
            {chart!.departments.map(item => <label key={item.id} className="org-check"><input type="checkbox" checked={leads.includes(item.id)} onChange={event => setLeads(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> {item.name}</label>)}
          </fieldset>}
          <label className="form-label">Reason <span className="muted">(optional)</span>
            <input className="input" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="Why this change?" />
          </label>
          <div className="notice">Changing a title or reporting line does not change this person’s system permissions, compensation, equity or contract terms.</div>
        </div>}
        {subject && step === "review" && review && <div className="org-review">
          <p className="muted">{mode === "apply" ? "Please review before confirming. This is recorded with your name and the time." : "This will be sent to an approver. Nothing changes until it is approved."}</p>
          <ul>{review.summary.map(line => <li key={line}>{line}</li>)}</ul>
        </div>}
        {error && <div className="person-field-error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        {step === "review" && <button className="btn" onClick={() => setStep("edit")} disabled={busy}>Back</button>}
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        {subject && step === "edit" && <button className="btn primary" onClick={() => void goReview()} disabled={busy}>Review changes</button>}
        {subject && step === "review" && <button className="btn primary" onClick={() => void confirm()} disabled={busy}>{busy ? "Saving…" : mode === "apply" ? "Confirm change" : "Send proposal"}</button>}
      </div>
    </div>
  </div>;
}

/* ------------------------------- Org view ------------------------------- */

export function OrgView({ org, onChangeRole, flash, avatars = {} }: { org: OrgAccess; onChangeRole: (ref: string) => void; flash: Flash; avatars?: Record<string, string> }) {
  const [tab, setTab] = useState<"chart" | "proposals" | "history" | "access">("chart");
  const [chart, setChart] = useState<Chart | null>(null);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState("");
  const [alumni, setAlumni] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const canChange = org.can("org.approve") || org.can("org.propose");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const query = new URLSearchParams();
      if (asOf) query.set("asOf", new Date(`${asOf}T23:59:59`).toISOString());
      if (alumni) query.set("alumni", "1");
      const result = await api(`/api/org/chart?${query}`);
      if (cancelled) return;
      if (result.ok) { setChart(result.body); setError(""); } else setError(result.body.error || "Could not load the organisation.");
    })();
    return () => { cancelled = true; };
  }, [asOf, alumni, reloadKey, org.version]);

  const reload = () => setReloadKey(value => value + 1);
  const tabs = [
    { id: "chart" as const, label: "Chart", show: true },
    // Proposals, History and Authority are intentionally not shown for now: the page is the chart only.
    // The components and API remain, so a tab can be switched back on here without other changes.
    { id: "proposals" as const, label: "Proposals", show: false },
    { id: "history" as const, label: "History", show: false },
    { id: "access" as const, label: "Authority", show: false },
  ].filter(item => item.show);

  return <div className="org-page">
    <div className="page-head"><div><div className="eyebrow">Company structure</div><h1 className="title">Organisation</h1><p className="subtitle">Built live from Olyxee’s records. Titles, reporting lines and permissions are managed separately.</p></div></div>
    {tabs.length > 1 && <div className="project-task-filters org-tabs" role="tablist">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "selected" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>}
    {error && <div className="panel"><div className="empty"><strong>Organisation unavailable</strong>{error}</div></div>}
    {tab === "chart" && !chart && !error && <ChartSkeleton />}
    {tab === "chart" && chart && <ChartTab avatars={avatars} chart={chart} canChange={canChange} proposeOnly={!org.can("org.approve")} onChangeRole={onChangeRole}
      asOf={asOf} setAsOf={setAsOf} alumni={alumni} setAlumni={setAlumni} showIssues={showIssues} setShowIssues={setShowIssues} />}
    {tab === "proposals" && <ProposalsTab org={org} chart={chart} flash={flash} onChanged={() => { reload(); void org.refresh(); }} />}
    {tab === "history" && <HistoryTab chart={chart} />}
    {tab === "access" && <AccessTab chart={chart} flash={flash} />}
  </div>;
}

/** Placeholder shaped like the hierarchy, so people know the chart is on its way. */
function ChartSkeleton() {
  const card = (key: string, root = false) => <div key={key} className={`org-card org-skel-card${root ? " org-card-root" : ""}`}>
    <span className="org-skel org-skel-avatar" /><span className="org-skel org-skel-line w60" /><span className="org-skel org-skel-line w80" /><span className="org-skel org-skel-line w40" />
  </div>;
  return <div className="panel org-hier-wrap" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Loading the organisation chart…</span>
    <div className="org-skel-tree" aria-hidden="true">
      <div className="org-skel-row">{card("root", true)}</div>
      <span className="org-skel-link" />
      <div className="org-skel-row">{["a", "b", "c"].map(key => card(`l2-${key}`))}</div>
      <span className="org-skel-link" />
      <div className="org-skel-row">{["d", "e", "f"].map(key => card(`l3-${key}`))}</div>
    </div>
    <p className="muted org-skel-note">Loading the organisation chart…</p>
  </div>;
}

function ChartTab({ avatars, chart, canChange, proposeOnly, onChangeRole, asOf, setAsOf, alumni, setAlumni, showIssues, setShowIssues }: {
  avatars: Record<string, string>; chart: Chart; canChange: boolean; proposeOnly: boolean; onChangeRole: (ref: string) => void; asOf: string; setAsOf: (value: string) => void;
  alumni: boolean; setAlumni: (value: boolean) => void; showIssues: boolean; setShowIssues: (value: boolean) => void;
}) {
  const historic = Boolean(chart.asOf);
  const row = (ref: string, depth: number, trail: Set<string>): React.ReactNode => {
    const node = chart.nodes[ref];
    if (!node || trail.has(ref)) return null;
    const next = new Set(trail).add(ref);
    const led = node.leadsDepartments.map(id => departmentName(chart, id));
    return <li key={ref}>
      <div className={`org-row${node.active ? "" : " org-inactive"}`}>
        <div className="org-person">
          <b>{node.name}</b>
          <span className="muted">{node.title || "No title"}{node.department ? ` · ${node.department}` : ""}</span>
        </div>
        <div className="org-badges">
          {led.length > 0 && <span className="badge green">Leads {led.join(", ")}</span>}
          {node.supervisedInterns.length > 0 && <span className="badge gray">Supervises {node.supervisedInterns.length}</span>}
          {node.functionalLeads.length > 0 && <span className="badge amber">Dotted line: {node.functionalLeads.map(item => nameOf(chart, item)).join(", ")}</span>}
          {!node.active && <span className="badge red">{node.status}</span>}
        </div>
        {canChange && !historic && node.employmentType !== undefined && <button className="btn" onClick={() => onChangeRole(ref)}>{proposeOnly ? "Propose change" : "Change role"} <ChevronRight size={13} /></button>}
      </div>
      {(node.directReports.length > 0 || node.supervisedInterns.length > 0) && <ul>
        {node.directReports.map(child => row(child, depth + 1, next))}
        {node.supervisedInterns.map(child => {
          const intern = chart.nodes[child];
          return intern ? <li key={`i-${child}`}><div className="org-row org-intern">
            <div className="org-person"><b>{intern.name}</b><span className="muted">{intern.title || "Intern"}{intern.department ? ` · ${intern.department}` : ""} · supervised</span></div>
            <div className="org-badges">{!intern.active && <span className="badge gray">{intern.status}</span>}</div>
            {canChange && !historic && <button className="btn" onClick={() => onChangeRole(child)}>{proposeOnly ? "Propose change" : "Change role"} <ChevronRight size={13} /></button>}
          </div></li> : null;
        })}
      </ul>}
    </li>;
  };
  const unsupervised = Object.values(chart.nodes).filter(node => node.employmentType === "Intern" && !node.internSupervisor);
  const [layout, setLayout] = useState<"tree" | "list">("tree");

  // Top-down hierarchy: direct reports first, then supervised interns, all as children of the same person.
  const card = (ref: string, trail: Set<string>): React.ReactNode => {
    const node = chart.nodes[ref];
    if (!node || trail.has(ref)) return null;
    const next = new Set(trail).add(ref);
    const children = [...new Set([...node.directReports, ...node.supervisedInterns])].filter(child => chart.nodes[child] && !next.has(child));
    const intern = node.employmentType === "Intern";
    const led = node.leadsDepartments.map(id => departmentName(chart, id));
    const initials = node.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    return <li key={ref}>
      <div className={`org-card${intern ? " org-card-intern" : ""}${node.active ? "" : " org-inactive"}${trail.size === 0 ? " org-card-root" : ""}`}>
        {avatars[ref] ? <img className="org-avatar org-avatar-photo" src={avatars[ref]} alt={`${node.name}'s profile`} /> : <span className="org-avatar" aria-hidden="true">{initials}</span>}
        <b className="org-card-name">{node.name}</b>
        <span className="org-card-title">{node.title && node.title !== "Title not set" ? node.title : (intern ? "Intern" : "Title not set")}</span>
        {node.department && <span className="org-card-dept">{node.department}</span>}
        <span className="org-card-badges">
          {intern && <span className="badge gray">Intern</span>}
          {led.length > 0 && <span className="badge green">Leads {led.join(", ")}</span>}
          {children.length > 0 && <span className="badge gray">{children.length} {children.length === 1 ? "report" : "reports"}</span>}
          {node.functionalLeads.length > 0 && <span className="badge amber">Dotted line: {node.functionalLeads.map(item => nameOf(chart, item)).join(", ")}</span>}
          {!node.active && <span className="badge red">{node.status}</span>}
        </span>
        {canChange && !historic && <button className="btn org-card-action" onClick={() => onChangeRole(ref)}>{proposeOnly ? "Propose change" : "Change role"}</button>}
      </div>
      {children.length > 0 && <ul>{children.map(child => card(child, next))}</ul>}
    </li>;
  };
  return <>
    <div className="filters">
      <label className="form-label org-inline">View as of <input className="input" type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={event => setAsOf(event.target.value)} /></label>
      {asOf && <button className="btn" onClick={() => setAsOf("")}>Back to today</button>}
      <label className="org-check"><input type="checkbox" checked={alumni} onChange={event => setAlumni(event.target.checked)} /> Include completed internships</label>
      <span className="org-layout-toggle" role="group" aria-label="Chart layout">
        <button type="button" className={`btn${layout === "tree" ? " primary" : ""}`} aria-pressed={layout === "tree"} onClick={() => setLayout("tree")}>Hierarchy</button>
        <button type="button" className={`btn${layout === "list" ? " primary" : ""}`} aria-pressed={layout === "list"} onClick={() => setLayout("list")}>List</button>
      </span>
      <span className="muted org-count">{chart.counts.employees} employees · {chart.counts.interns} interns</span>
    </div>
    {historic && <div className="notice">Showing the organisation as it was on {new Date(chart.asOf!).toLocaleDateString()}. Changes can only be made to today’s structure.</div>}
    {chart.issues.length > 0 && <div className="panel org-issues"><button className="org-issues-head" onClick={() => setShowIssues(!showIssues)} aria-expanded={showIssues}><b>{chart.issues.length} item{chart.issues.length === 1 ? "" : "s"} need attention</b><span className="muted">{showIssues ? "Hide" : "Show"}</span></button>
      {showIssues && <ul>{chart.issues.map((issue, index) => <li key={`${issue.ref}-${index}`}>{issue.message}</li>)}</ul>}</div>}
    {layout === "tree"
      ? <div className="panel org-hier-wrap"><div className="org-hier"><ul>{chart.roots.map(ref => card(ref, new Set()))}</ul></div>
        {!chart.roots.length && <div className="empty"><strong>No organisation records yet</strong>Records appear here once the organisation data has been set up.</div>}
      </div>
      : <div className="panel org-tree"><ul>{chart.roots.map(ref => row(ref, 0, new Set()))}</ul>
        {!chart.roots.length && <div className="empty"><strong>No organisation records yet</strong>Records appear here once the organisation data has been set up.</div>}
      </div>}
    {unsupervised.length > 0 && <div className="panel org-tree"><div className="panel-head"><h2 className="panel-title">Interns without a supervisor <span>{unsupervised.length}</span></h2></div>
      <ul>{unsupervised.map(intern => <li key={intern.ref}><div className="org-row org-intern"><div className="org-person"><b>{intern.name}</b><span className="muted">{intern.title || "Intern"}</span></div>
        {canChange && !historic && <button className="btn" onClick={() => onChangeRole(intern.ref)}>{proposeOnly ? "Propose supervisor" : "Assign supervisor"}</button>}</div></li>)}</ul></div>}
  </>;
}

function ProposalsTab({ org, chart, flash, onChanged }: { org: OrgAccess; chart: Chart | null; flash: Flash; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [stale, setStale] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await api("/api/org/proposals");
    if (result.ok) setItems(result.body.proposals); else setError(result.body.error || "Could not load proposals.");
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (id: string, decision: "approve" | "reject", acknowledgeChanges = false) => {
    const result = await api(`/api/org/proposals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, acknowledgeChanges }) });
    if (result.body.code === "stale") { setStale(id); return; }
    if (!result.ok) { flash(result.body.error || "Could not record the decision."); return; }
    setStale(null);
    flash(decision === "approve" ? "Proposal approved and applied." : "Proposal declined.");
    await load();
    onChanged();
  };
  const withdraw = async (id: string) => {
    const result = await api(`/api/org/proposals/${id}/withdraw`, { method: "POST" });
    if (!result.ok) { flash(result.body.error || "Could not withdraw."); return; }
    await load();
  };
  return <div className="panel"><div className="list">
    {error && <div className="empty">{error}</div>}
    {items.map(item => <div className="row org-proposal" key={item.id}>
      <div className="row-main">
        <div className="row-title">{describeProposal(item.payload, chart)}</div>
        <div className="row-meta">Proposed by {item.proposed_by_name} · {new Date(item.created_at).toLocaleDateString()}{item.reason ? ` · “${item.reason}”` : ""}</div>
        {stale === item.id && <div className="notice">The organisation has changed since this was proposed. <button className="btn" onClick={() => void decide(item.id, "approve", true)}>Approve anyway</button></div>}
      </div>
      <span className={`badge ${item.status === "approved" ? "green" : item.status === "pending" ? "amber" : "gray"}`}>{item.status}</span>
      {item.status === "pending" && org.can("org.approve") && <><button className="btn primary" onClick={() => void decide(item.id, "approve")}>Approve</button><button className="btn" onClick={() => void decide(item.id, "reject")}>Decline</button></>}
      {item.status === "pending" && !org.can("org.approve") && <button className="btn" onClick={() => void withdraw(item.id)}>Withdraw</button>}
    </div>)}
    {!items.length && !error && <div className="empty"><strong>No proposals</strong>Proposed changes appear here for approval.</div>}
  </div></div>;
}

function HistoryTab({ chart }: { chart: Chart | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void (async () => {
    const result = await api("/api/org/history?limit=200");
    if (result.ok) setItems(result.body.history); else setError(result.body.error || "Could not load history.");
  })(); }, []);
  return <div className="panel"><div className="list">
    {error && <div className="empty">{error}</div>}
    {items.map(item => <div className="row" key={item.id}>
      <div className="row-main">
        <div className="row-title">{(item.subject_refs || []).slice(0, 1).map((ref: string) => nameOf(chart, ref)).join("") || "Organisation"}</div>
        <div className="row-meta">{describeChange(item, chart).join(" · ")}</div>
        {item.reason && <div className="row-meta">“{item.reason}”</div>}
      </div>
      <div className="row-meta org-when">{item.actor_name}<br />{new Date(item.created_at).toLocaleString()}</div>
    </div>)}
    {!items.length && !error && <div className="empty"><strong>No changes yet</strong>Every organisational change is recorded here with who made it and when.</div>}
  </div></div>;
}

function AccessTab({ chart, flash }: { chart: Chart | null; flash: Flash }) {
  const [grants, setGrants] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [userId, setUserId] = useState("");
  const [capability, setCapability] = useState("org.view_all");
  const [scope, setScope] = useState("");
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api("/api/org/capabilities"), api("/api/org/accounts")]);
    if (a.ok) setGrants(a.body.capabilities);
    if (b.ok) setAccounts(b.body.accounts);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const grant = async () => {
    const result = await api("/api/org/capabilities", { method: "POST", body: JSON.stringify({ userId, capability, scopeDepartmentId: capability === "delivery.view" && scope ? scope : null }) });
    flash(result.ok ? "Authority granted." : result.body.error || "Could not grant.");
    if (result.ok) await load();
  };
  const revoke = async (item: any) => {
    const result = await api("/api/org/capabilities", { method: "DELETE", body: JSON.stringify({ userId: item.user_id, capability: item.capability, scopeDepartmentId: item.scope_department_id }) });
    flash(result.ok ? "Authority removed." : result.body.error || "Could not remove.");
    if (result.ok) await load();
  };
  return <>
    <div className="notice">Organisational authority is granted explicitly here. A job title, reporting line or Superadmin role never grants it.</div>
    <div className="panel"><div className="panel-head"><h2 className="panel-title">Who can do what</h2></div><div className="list">
      {grants.map(item => <div className="row" key={item.id}>
        <div className="row-main"><div className="row-title">{item.display_name}</div><div className="row-meta">{CAPABILITY_LABELS[item.capability] || item.capability}{item.scope_department_id ? ` · ${departmentName(chart, item.scope_department_id)}` : ""} · granted {new Date(item.granted_at).toLocaleDateString()}{item.granted_by_name ? ` by ${item.granted_by_name}` : ""}</div></div>
        <button className="btn" onClick={() => void revoke(item)}>Remove</button>
      </div>)}
      {!grants.length && <div className="empty">No authority has been granted yet.</div>}
    </div></div>
    <div className="panel org-grant"><div className="panel-head"><h2 className="panel-title">Grant authority</h2></div><div className="filters org-grant-form">
      <select className="select" value={userId} onChange={event => setUserId(event.target.value)} aria-label="Person"><option value="">Choose a person</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
      <select className="select" value={capability} onChange={event => setCapability(event.target.value)} aria-label="Authority">{Object.entries(CAPABILITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      {capability === "delivery.view" && <select className="select" value={scope} onChange={event => setScope(event.target.value)} aria-label="Department"><option value="">All departments</option>{(chart?.departments || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <button className="btn primary" disabled={!userId} onClick={() => void grant()}>Grant</button>
    </div></div>
  </>;
}
