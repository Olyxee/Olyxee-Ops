import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload, UserRound } from "lucide-react";
import "./org.css";
import { PhotoEditor, checkPhotoFile } from "./PhotoEditor";

/**
 * Blocking prompt shown to anyone signed in without a profile picture. It cannot be dismissed: the
 * team needs to see who they are working with. Saving only sends the picture; the server merges it
 * into the existing profile so nothing else is overwritten.
 */
export function AvatarPrompt({ name, onSaved }: { name: string; onSaved: (avatarUrl: string) => void }) {
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // Unskippable: the app behind is made inert (no clicks, no Tab, no screen reader access), focus stays inside the prompt,
  // and Escape does nothing. It goes away only when the picture is saved and this component is removed.
  useEffect(() => {
    const app = document.getElementById("root");
    app?.setAttribute("inert", "");
    app?.setAttribute("aria-hidden", "true");
    const keep = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); return; }
      if (event.key !== "Tab") return;
      const items = Array.from(box.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])") || []).filter(item => item.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!box.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keep, true);
    const focusTimer = window.setTimeout(() => box.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus(), 50);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", keep, true);
      app?.removeAttribute("inert");
      app?.removeAttribute("aria-hidden");
    };
  }, []);

  const [picked, setPicked] = useState<File | null>(null);
  const choose = (file?: File) => {
    if (!file) return;
    const problem = checkPhotoFile(file);
    if (problem) { setError(problem); return; }
    setError(""); setPicked(file);
  };
  const save = async () => {
    if (!image) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarUrl: image }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save your picture.");
      onSaved(body.avatarUrl || image);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not save your picture."); } finally { setBusy(false); }
  };

  return createPortal(<div className="modal-back avatar-prompt-back" role="presentation" onMouseDown={event => event.stopPropagation()}>
    {picked && <PhotoEditor file={picked} name={name} onCancel={() => setPicked(null)} onApply={result => { setImage(result); setPicked(null); }} />}
    <div ref={box} className="modal avatar-prompt" role="alertdialog" aria-modal="true" aria-label="Add your profile picture">
      <div className="modal-head"><b>Add your profile picture</b><small className="avatar-prompt-required">Required</small></div>
      <div className="modal-body">
        <div className="avatar-prompt-preview">{image ? <img src={image} alt="Your profile preview" /> : <UserRound size={56} strokeWidth={1.5} />}</div>
        <p className="muted">{name ? `${name}, ` : ""}the team needs to see who they are working with. Please add a clear photo of your face to continue.</p>
        {error && <div className="notice" role="alert">{error}</div>}
        <input ref={input} type="file" accept="image/*" hidden onChange={event => { choose(event.target.files?.[0]); event.target.value = ""; }} />
        {image && <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>Reframe</button>}
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}><Upload size={14} /> {image ? "Choose a different photo" : "Choose a photo"}</button>
      </div>
      <div className="modal-foot"><button type="button" className="btn primary" onClick={() => void save()} disabled={!image || busy}>{busy ? "Saving…" : "Save and continue"}</button></div>
    </div>
  </div>, document.body);
}
