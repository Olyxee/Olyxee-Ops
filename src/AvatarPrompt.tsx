import { useRef, useState } from "react";
import { Upload, UserRound } from "lucide-react";
import "./org.css";

// Same square crop + compression as the profile settings page, so every photo has the same shape and size.
async function toProfileImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  if (file.size > 8 * 1024 * 1024) throw new Error("Profile image must be smaller than 8 MB");
  const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new window.Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("Could not read this image")); element.src = source; });
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process this image");
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
  const result = canvas.toDataURL("image/jpeg", 0.78);
  if (result.length > 450000) throw new Error("This image could not be compressed enough. Choose a smaller image.");
  return result;
}

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

  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError("");
    try { setImage(await toProfileImage(file)); } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not process this image"); } finally { setBusy(false); }
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
    <div className="modal avatar-prompt" role="dialog" aria-modal="true" aria-label="Add your profile picture">
      <div className="modal-head"><b>Add your profile picture</b></div>
      <div className="modal-body">
        <div className="avatar-prompt-preview">{image ? <img src={image} alt="Your profile preview" /> : <UserRound size={56} strokeWidth={1.5} />}</div>
        <p className="muted">{name ? `${name}, ` : ""}the team needs to see who they are working with. Please add a clear photo of your face to continue.</p>
        {error && <div className="notice" role="alert">{error}</div>}
        <input ref={input} type="file" accept="image/*" hidden onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}><Upload size={14} /> {image ? "Choose a different photo" : "Choose a photo"}</button>
      </div>
      <div className="modal-foot"><button type="button" className="btn primary" onClick={() => void save()} disabled={!image || busy}>{busy ? "Saving…" : "Save and continue"}</button></div>
    </div>
  </div>;
}
