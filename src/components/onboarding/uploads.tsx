"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { uploadOnboardingImage } from "./useOnboardingForm";

/* eslint-disable @next/next/no-img-element */

export function SingleUpload({
  value,
  onChange,
  kind,
  label = "Upload image",
  hint = "PNG or JPG, up to 6 MB",
  aspect = "1 / 1",
}: {
  value: string;
  onChange: (url: string) => void;
  kind: string;
  label?: string;
  hint?: string;
  aspect?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const url = await uploadOnboardingImage(file, kind);
      onChange(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="mk-thumb" style={{ width: 120, aspectRatio: aspect }}>
        <img src={value} alt="" />
        <button type="button" className="mk-thumb-x" aria-label="Remove image" onClick={() => onChange("")}>
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="mk-upload"
        data-busy={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 size={22} className="mk-spin" /> : <ImagePlus size={22} />}
        <b>{busy ? "Uploading…" : label}</b>
        <small>{hint}</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="mk-sr"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {err && <p className="mk-error">{err}</p>}
    </div>
  );
}

export function MultiUpload({
  value,
  onChange,
  kind,
  max = 6,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  kind: string;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files || !files.length) return;
    setErr(null);
    setBusy(true);
    try {
      const room = Math.max(0, max - value.length);
      const picked = Array.from(files).slice(0, room);
      const urls = await Promise.all(picked.map((f) => uploadOnboardingImage(f, kind)));
      onChange([...value, ...urls]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mk-thumb-grid">
        {value.map((url, i) => (
          <div className="mk-thumb" key={url + i}>
            <img src={url} alt="" />
            <button
              type="button"
              className="mk-thumb-x"
              aria-label="Remove image"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        {value.length < max && (
          <button
            type="button"
            className="mk-upload"
            data-busy={busy}
            style={{ aspectRatio: "1 / 1", padding: 10 }}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 size={20} className="mk-spin" /> : <ImagePlus size={20} />}
            <small>{busy ? "Uploading…" : "Add"}</small>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="mk-sr"
        onChange={(e) => pick(e.target.files)}
      />
      {err && <p className="mk-error">{err}</p>}
    </div>
  );
}
