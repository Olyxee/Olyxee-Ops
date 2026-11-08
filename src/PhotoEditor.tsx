import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import "./photo-editor.css";

// Profile photo framing: drag to reposition, zoom to fit, and see the result at the sizes it will actually appear.
// The result is always a 320x320 JPEG, exactly what the rest of the app already stores, so nothing else changes.

const STAGE = 280;      // on-screen crop square
const OUTPUT = 320;     // saved size
const MAX_ZOOM = 4;

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function checkPhotoFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Choose an image file";
  if (file.size > MAX_PHOTO_BYTES) return "Profile image must be smaller than 8 MB";
  return null;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function PhotoEditor({ file, name, onApply, onCancel }: { file: File; name?: string; onApply: (dataUrl: string) => void; onCancel: () => void }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });   // image centre relative to the stage centre, in stage pixels
  const [preview, setPreview] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new window.Image();
    element.onload = () => setImage(element);
    element.onerror = () => setError("Could not read this image");
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = image ? STAGE / Math.min(image.naturalWidth, image.naturalHeight) : 1;   // zoom 1 = the photo just covers the square
  const scale = base * zoom;
  const limit = useMemo(() => image
    ? { x: Math.max(0, (image.naturalWidth * scale - STAGE) / 2), y: Math.max(0, (image.naturalHeight * scale - STAGE) / 2) }
    : { x: 0, y: 0 }, [image, scale]);
  const position = { x: clamp(offset.x, -limit.x, limit.x), y: clamp(offset.y, -limit.y, limit.y) };

  const render = (size: number) => {
    if (!image) return "";
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return "";
    const ratio = size / STAGE;
    const width = image.naturalWidth * scale * ratio;
    const height = image.naturalHeight * scale * ratio;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, size / 2 + position.x * ratio - width / 2, size / 2 + position.y * ratio - height / 2, width, height);
    return canvas.toDataURL("image/jpeg", 0.78);
  };

  // Live preview, drawn from the same crop that will be saved.
  useEffect(() => {
    if (!image) return;
    const frame = requestAnimationFrame(() => setPreview(render(160)));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, zoom, position.x, position.y]);

  const apply = () => {
    const result = render(OUTPUT);
    if (!result) { setError("Could not process this image"); return; }
    if (result.length > 450000) { setError("This image could not be compressed enough. Choose a smaller image."); return; }
    onApply(result);
  };
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  const nudge = (dx: number, dy: number) => setOffset({ x: clamp(position.x + dx, -limit.x, limit.x), y: clamp(position.y + dy, -limit.y, limit.y) });
  const initials = (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

  return <div className="modal-back photo-editor-back" role="presentation">
    <div className="modal photo-editor" role="dialog" aria-modal="true" aria-label="Frame your profile photo">
      <div className="modal-head"><b>Frame your photo</b></div>
      <div className="modal-body">
        <div className="photo-editor-grid">
          <div className="photo-editor-stage-wrap">
            <div
              className="photo-editor-stage" style={{ width: STAGE, height: STAGE }} tabIndex={0}
              aria-label="Drag to reposition. Use arrow keys to nudge, plus and minus to zoom."
              onPointerDown={event => { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, ox: position.x, oy: position.y }; }}
              onPointerMove={event => { if (!drag.current) return; setOffset({ x: clamp(drag.current.ox + event.clientX - drag.current.x, -limit.x, limit.x), y: clamp(drag.current.oy + event.clientY - drag.current.y, -limit.y, limit.y) }); }}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}
              onWheel={event => setZoom(value => clamp(value - event.deltaY * 0.002, 1, MAX_ZOOM))}
              onKeyDown={event => {
                const step = event.shiftKey ? 20 : 6;
                if (event.key === "ArrowLeft") { event.preventDefault(); nudge(step, 0); }
                else if (event.key === "ArrowRight") { event.preventDefault(); nudge(-step, 0); }
                else if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, step); }
                else if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, -step); }
                else if (event.key === "+" || event.key === "=") setZoom(value => clamp(value + 0.1, 1, MAX_ZOOM));
                else if (event.key === "-") setZoom(value => clamp(value - 0.1, 1, MAX_ZOOM));
              }}
            >
              {image && <img
                src={image.src} alt="" draggable={false}
                style={{ width: image.naturalWidth * scale, height: image.naturalHeight * scale, transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))` }}
              />}
              <span className="photo-editor-mask" aria-hidden="true" />
              {!image && !error && <span className="photo-editor-wait">Loading…</span>}
            </div>
            <div className="photo-editor-zoom">
              <button type="button" className="btn" aria-label="Zoom out" onClick={() => setZoom(value => clamp(value - 0.2, 1, MAX_ZOOM))}><Minus size={14} /></button>
              <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} aria-label="Zoom" onChange={event => setZoom(Number(event.target.value))} />
              <button type="button" className="btn" aria-label="Zoom in" onClick={() => setZoom(value => clamp(value + 0.2, 1, MAX_ZOOM))}><Plus size={14} /></button>
              <button type="button" className="btn" aria-label="Reset" title="Reset" onClick={reset}><RotateCcw size={14} /></button>
            </div>
            <small className="muted">Drag the photo to position your face. Scroll or use the slider to zoom.</small>
          </div>
          <div className="photo-editor-previews" aria-label="How it will look">
            <small className="photo-editor-label">How it will look</small>
            <div className="photo-editor-preview-card">
              <span className="photo-preview large">{preview ? <img src={preview} alt="" /> : initials}</span>
              <b>{name || "Your name"}</b>
              <small>Your profile card</small>
            </div>
            <div className="photo-editor-preview-row">
              <span className="photo-preview medium">{preview ? <img src={preview} alt="" /> : initials}</span>
              <span className="photo-preview small">{preview ? <img src={preview} alt="" /> : initials}</span>
              <small>Lists, tasks and the org chart</small>
            </div>
          </div>
        </div>
        {error && <div className="notice" role="alert">{error}</div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" disabled={!image} onClick={apply}>Use this photo</button>
      </div>
    </div>
  </div>;
}
