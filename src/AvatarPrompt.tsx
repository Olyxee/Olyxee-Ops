import { useRef, useState } from "react";
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

  return <div className="modal-back" role="presentation">
    {picked && <PhotoEditor file={picked} name={name} onCancel={() => setPicked(null)} onApply={result => { setImage(result); setPicked(null); }} />}
    <div className="modal avatar-prompt" role="dialog" aria-modal="true" aria-label="Add your profile picture">
      <div className="modal-head"><b>Add your profile picture</b></div>
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
  </div>;
}
