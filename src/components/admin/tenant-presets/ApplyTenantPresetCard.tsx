"use client";

// "Store preset" panel on an existing tenant's admin page — converting a live
// store to a different shape (e.g. adding the group-buy + on-hand two-ways
// storefront) without a bespoke configure-<slug>.ts script.
//
// Preview-then-confirm, deliberately: this rewrites branding.config keys and
// grants entitlements on a store that already has customers, so the operator sees
// the exact before→after list first. The underlying applier is additive and
// idempotent (lib/tenant/presets.ts), so a double-click is harmless.
//
// Styled with the scoped .sa design system (card / card-head / btn + CSS vars)
// to match the rest of the platform admin — not Tailwind/shadcn.

import { useState, useTransition } from "react";
import { TENANT_PRESET_LIST } from "@/lib/tenant/presets";
import {
  applyTenantPresetAction,
  previewTenantPresetAction,
  type PresetPreview,
} from "@/actions/tenant-presets";

/**
 * Render a config value compactly for the diff list. Objects report their key
 * count rather than a bare "{…}" — an opaque placeholder on both sides of the
 * arrow would hide the scale of what is being written.
 */
function short(v: unknown): string {
  if (v === undefined) return "not set";
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return `{${Object.keys(v as object).length} keys}`;
  return String(v);
}

export function ApplyTenantPresetCard({ slug }: { slug: string }) {
  const [presetId, setPresetId] = useState(TENANT_PRESET_LIST[0]?.id ?? "");
  const [preview, setPreview] = useState<PresetPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPreview(null);
    setErr(null);
    setDone(null);
  };

  const runPreview = () => {
    reset();
    startTransition(async () => {
      const res = await previewTenantPresetAction({ slug, presetId });
      if ("error" in res) setErr(res.error);
      else setPreview(res.preview);
    });
  };

  const runApply = () => {
    startTransition(async () => {
      const res = await applyTenantPresetAction({ slug, presetId });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      setPreview(null);
      setDone(
        res.changed === 0
          ? "Already up to date — nothing changed."
          : `Applied. ${res.changed} change${res.changed === 1 ? "" : "s"} written.`,
      );
    });
  };

  const configChanges = preview?.changes.filter((c) => c.kind === "config") ?? [];
  const featureChanges = preview?.changes.filter((c) => c.kind === "feature") ?? [];
  const themeChange = preview?.changes.find((c) => c.kind === "theme");
  const hasChanges = (preview?.changes.length ?? 0) > 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Store preset</h3>
          <div className="card-sub">
            Stamp a whole store shape onto this tenant — layout, modules and entitlements.
            Additive: name, logo, colors, catalog and lab reports are never touched, and existing
            group-buy rules, copy and round defaults are kept as the owner set them.
          </div>
        </div>
      </div>

      <div className="card-body" style={{ display: "grid", gap: 10, padding: 16 }}>
        <div style={{ display: "grid", gap: 6 }}>
          {TENANT_PRESET_LIST.map((p) => (
            <label
              key={p.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: 10,
                borderRadius: 6,
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="tenant-preset"
                checked={presetId === p.id}
                onChange={() => {
                  setPresetId(p.id);
                  reset();
                }}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
                  {p.tagline}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={runPreview} disabled={pending}>
            {pending && !preview ? "Checking…" : "Preview changes"}
          </button>
          {hasChanges && (
            <button type="button" className="btn btn-sm btn-primary" onClick={runApply} disabled={pending}>
              {pending ? "Applying…" : "Apply preset"}
            </button>
          )}
        </div>

        {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
        {done && <div style={{ fontSize: 12, color: "var(--success, #137A50)" }}>{done}</div>}

        {preview && !hasChanges && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            This tenant already matches <strong>{preview.presetName}</strong>. Nothing would change.
          </div>
        )}

        {preview && hasChanges && (
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-canvas)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {preview.changes.length} change{preview.changes.length === 1 ? "" : "s"} to apply
            </div>

            {themeChange?.kind === "theme" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Theme: <span className="mono">{themeChange.from || "—"}</span> →{" "}
                <span className="mono">{themeChange.to}</span>
              </div>
            )}

            {configChanges.map((c) =>
              c.kind === "config" ? (
                <div key={c.key} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  <span className="mono">{c.key}</span>: {short(c.from)} →{" "}
                  <strong>{short(c.to)}</strong>
                </div>
              ) : null,
            )}

            {featureChanges.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Grants:{" "}
                <span className="mono">
                  {featureChanges.map((c) => (c.kind === "feature" ? c.key : "")).join(", ")}
                </span>
              </div>
            )}

            {preview.missingFeatures.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--warning, #9A6206)" }}>
                Not seeded in the feature catalog and will be skipped:{" "}
                <span className="mono">{preview.missingFeatures.join(", ")}</span>. Run{" "}
                <span className="mono">npm run db:sync-features</span>, then apply again.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
