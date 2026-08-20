"use client";

/**
 * The form primitives shared by the platform's per-tenant Branding surfaces.
 *
 * These began inside BrandingEditor and moved out when a second panel (the
 * loading-screen editor) needed them: importing them back out of BrandingEditor
 * would have made the two files a cycle, and copying them would have let the
 * upload's error handling drift between the panels that use it.
 *
 * Nothing here is tenant-facing — every one of these renders in the platform
 * operator console only.
 */

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { uploadBrandingAssetAction, removeBrandingAssetAction } from "@/actions/branding";
import { brandingAssetRules, type BrandingAssetKind } from "@/lib/upload/branding-assets";
import { settleUpload } from "@/lib/upload/settle";

export function CollapsibleSection({
  title,
  summary,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-[var(--radius)] border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge && <span className="text-xs text-muted-foreground">{badge}</span>}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </section>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <div className="mt-1 flex gap-1">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={`flex-1 rounded-[var(--radius)] border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            value === opt ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
          }`}
        >
          {render(opt)}
        </button>
      ))}
    </div>
  );
}

export function AssetUpload({
  slug,
  kind,
  label,
  help,
  value,
  onChange,
}: {
  slug: string;
  kind: BrandingAssetKind;
  label: string;
  help: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Offer the picker exactly what the server will take for THIS kind — a
  // product photo can't be an .ico, a favicon can. The extension is spelled out
  // alongside the MIME because some browsers won't match image/x-icon by type.
  const allowedTypes = brandingAssetRules(kind).allowedTypes;
  const accept = [...allowedTypes, ...(allowedTypes.has("image/x-icon") ? [".ico"] : [])].join(",");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    // settleUpload guarantees a resolved result even if the action throws (e.g.
    // Next rejecting an oversized body), so busy never sticks on "Uploading…".
    const res = await settleUpload(() => uploadBrandingAssetAction(slug, kind, fd));
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if ("error" in res) setError(res.error);
    else onChange(res.url);
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    const res = await settleUpload(() => removeBrandingAssetAction(slug, kind));
    setBusy(false);
    if ("error" in res) setError(res.error);
    else onChange(null);
  }

  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="max-h-12 max-w-12 object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">none</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{label}</span>
            {value && (
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                className="text-xs text-muted-foreground underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
        </div>
      </div>
      <div className="mt-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onFile}
          disabled={busy}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary-foreground disabled:opacity-50"
        />
        {busy && <p className="mt-1 text-xs text-muted-foreground">Uploading…</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

/**
 * An optional header color control. When `value` is unset it shows the inherited
 * `fallback` color in the swatch and a hint that it's inheriting; picking a color
 * sets the override, and the reset link clears it back to the brand default.
 */
export function HeaderColorField({
  label,
  help,
  value,
  fallback,
  onChange,
  onReset,
  resetLabel,
}: {
  label: string;
  help: string;
  value?: string;
  fallback: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <div>
      <label className="flex items-center gap-3">
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <span className="flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block text-xs text-muted-foreground">{help}</span>
        </span>
      </label>
      <div className="ml-[52px] mt-1">
        {value ? (
          <button type="button" onClick={onReset} className="text-xs text-primary underline">
            {resetLabel}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Inheriting brand default</span>
        )}
      </div>
    </div>
  );
}

