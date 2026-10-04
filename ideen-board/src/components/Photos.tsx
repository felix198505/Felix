import { useRef, useState } from "react";
import type { Attachment } from "../../shared/types";
import { useStore } from "../store";
import { Avatar } from "./Avatar";

/** Verkleinert ein Foto im Browser auf max. 1600 px (JPEG), damit es schnell lädt und wenig Platz braucht */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
}

export function Photos({ cardId, list, onChange }: { cardId: number; list: Attachment[]; onChange: (l: Attachment[]) => void }) {
  const { toast, reload } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Attachment | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const blob = await shrink(f);
        const res = await fetch(`/api/cards/${cardId}/attachments`, {
          method: "POST",
          headers: { "content-type": blob.type || "image/jpeg", "x-filename": encodeURIComponent(f.name) },
          body: blob,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload fehlgeschlagen");
        onChange(data);
      }
      toast("Foto gespeichert");
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(a: Attachment) {
    if (!confirm("Foto löschen?")) return;
    const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    if (res.ok) onChange(await res.json());
    setView(null);
    reload();
  }

  return (
    <div className="section">
      <h3>Fotos {list.length > 0 && `(${list.length})`}</h3>
      <div className="photos">
        {list.map((a) => (
          <button key={a.id} className="thumb" onClick={() => setView(a)} title={a.name}>
            <img src={`/api/attachments/${a.id}`} alt={a.name} loading="lazy" />
          </button>
        ))}
        <button className="thumb add" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <span className="spin">✦</span> : "📷"}
          <span>{busy ? "Lädt…" : "Foto"}</span>
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
      {list.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Die KI bezieht die neuesten 3 Fotos bei „Neu analysieren“ mit ein.</div>}
      {view && (
        <div className="lightbox" onClick={() => setView(null)}>
          <img src={`/api/attachments/${view.id}`} alt={view.name} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <Avatar id={view.user_id} size="sm" />
            <span className="grow small">{new Date(view.created_at).toLocaleString("de-DE")}</span>
            <a className="btn small" href={`/api/attachments/${view.id}`} target="_blank" rel="noreferrer">
              Öffnen
            </a>
            <button className="btn small danger" onClick={() => remove(view)}>
              Löschen
            </button>
            <button className="btn small" onClick={() => setView(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
