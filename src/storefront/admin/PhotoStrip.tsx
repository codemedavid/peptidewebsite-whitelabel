"use client";

import { useRef, useState } from "react";

/**
 * A row of extra photos: add several at once, remove, reorder, promote to main.
 *
 * Used twice in the product editor — for the product's own gallery and for each
 * variation's — so both follow one set of controls. It edits the EXTRAS only;
 * the main photo keeps its existing control (the drop zone, or the variation
 * row's thumb), which is why "Set as main" is a callback: the parent owns the
 * swap between the two.
 */
export function PhotoStrip({
  photos,
  onChange,
  onUpload,
  onMakeMain,
  max,
  label,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  /** Uploads one file → hosted URL or an error message (the parent's action). */
  onUpload: (file: File) => Promise<{ url?: string; error?: string }>;
  /** Promote a photo to the main one. The parent moves the old main in here. */
  onMakeMain?: (url: string) => void;
  /** Most extras allowed. */
  max: number;
  /** Names the owner in aria labels ("the product", "Silk Barbie"). */
  label: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState("");
  const room = Math.max(0, max - photos.length);

  // Sequential, like the bulk variation upload: the action takes one file, and
  // a failure part-way keeps the photos that already made it.
  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr("");
    const picked = Array.from(files).slice(0, room);
    const urls: string[] = [];
    let firstError = "";
    for (const [i, file] of picked.entries()) {
      setBusy({ done: i, total: picked.length });
      const res = await onUpload(file);
      if (res.url) urls.push(res.url);
      else if (res.error && !firstError) firstError = res.error;
    }
    setBusy(null);
    if (urls.length) onChange([...photos, ...urls].slice(0, max));
    if (firstError) setErr(`${firstError} (${urls.length} of ${picked.length} uploaded)`);
    else if (files.length > picked.length) {
      setErr(`Only ${max} extra photos fit — ${files.length - picked.length} skipped.`);
    }
  };

  const move = (from: number, delta: number) => {
    const to = from + delta;
    if (to < 0 || to >= photos.length) return;
    const next = [...photos];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };

  return (
    <div className="admin-photo-strip">
      <ul className="admin-photo-strip__list">
        {photos.map((url, i) => (
          <li key={url} className="admin-photo-strip__item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" />
            <div className="admin-photo-strip__tools">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move photo ${i + 2} of ${label} earlier`}
              >
                ‹
              </button>
              {onMakeMain && (
                <button
                  type="button"
                  onClick={() => onMakeMain(url)}
                  aria-label={`Make photo ${i + 2} the main photo of ${label}`}
                  title="Set as main photo"
                >
                  ★
                </button>
              )}
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === photos.length - 1}
                aria-label={`Move photo ${i + 2} of ${label} later`}
              >
                ›
              </button>
              <button
                type="button"
                onClick={() => onChange(photos.filter((u) => u !== url))}
                aria-label={`Remove photo ${i + 2} of ${label}`}
              >
                ×
              </button>
            </div>
          </li>
        ))}
        {room > 0 && (
          <li>
            <button
              type="button"
              className="admin-photo-strip__add"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              aria-label={`Add more photos of ${label}`}
            >
              {busy ? `${busy.done + 1}/${busy.total}…` : "+ Add"}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {err && (
        <div className="admin-form__hint" role="alert" style={{ color: "var(--sf-danger, #b42318)" }}>
          {err}
        </div>
      )}
    </div>
  );
}
