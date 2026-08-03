"use client";

// "Store preset" panel on an existing tenant's admin page — converting a live
// store to a different shape (e.g. adding the group-buy + on-hand two-ways
// storefront) without a bespoke configure-<slug>.ts script, and switching that
// shape back off again.
//
// Preview-then-confirm in BOTH directions, deliberately: each path rewrites
// branding.config keys and moves entitlements on a store that already has
// customers, so the operator sees the exact before→after list first. The
// underlying applier and remover are both idempotent (lib/tenant/presets.ts), so
// a double-click is harmless.
//
// The two directions are NOT symmetrical and the UI says so. Applying is purely
// additive. Removing is the only destructive path on this page: it revokes the
// preset's entitlements — including any the tenant held before the preset was
// applied — while leaving the theme, the catalog and the owner's own group-buy
// rules and copy untouched.
//
// Styled with the scoped .sa design system (card / card-head / btn + CSS vars)
// to match the rest of the platform admin — not Tailwind/shadcn.

import { useState, useTransition } from "react";
import { TENANT_PRESET_LIST } from "@/lib/tenant/presets";
import {
  applyTenantPresetAction,
  previewTenantPresetAction,
  previewRemoveTenantPresetAction,
  removeTenantPresetAction,
  type PresetPreview,
  type PresetRemovalPreview,
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

/** Which direction the operator is previewing. Null = nothing previewed yet. */
type Mode =
  | { kind: "apply"; data: PresetPreview }
  | { kind: "remove"; data: PresetRemovalPreview };

const muted = { fontSize: 12, color: "var(--text-muted)" } as const;

const panel = {
  padding: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-canvas)",
  display: "grid",
  gap: 6,
} as const;

export function ApplyTenantPresetCard({ slug }: { slug: string }) {
  const [presetId, setPresetId] = useState(TENANT_PRESET_LIST[0]?.id ?? "");
  const [mode, setMode] = useState<Mode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setMode(null);
    setErr(null);
    setDone(null);
  };

  const runPreview = (kind: "apply" | "remove") => {
    reset();
    startTransition(async () => {
      if (kind === "apply") {
        const res = await previewTenantPresetAction({ slug, presetId });
        if ("error" in res) setErr(res.error);
        else setMode({ kind: "apply", data: res.preview });
        return;
      }
      const res = await previewRemoveTenantPresetAction({ slug, presetId });
      if ("error" in res) setErr(res.error);
      else setMode({ kind: "remove", data: res.preview });
    });
  };

  const runApply = () => {
    startTransition(async () => {
      const res = await applyTenantPresetAction({ slug, presetId });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      setMode(null);
      setDone(
        res.changed === 0
          ? "Already up to date — nothing changed."
          : `Applied. ${res.changed} change${res.changed === 1 ? "" : "s"} written.`,
      );
    });
  };

  const runRemove = () => {
    startTransition(async () => {
      const res = await removeTenantPresetAction({ slug, presetId });
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      setMode(null);
      setDone(
        res.changed === 0
          ? "This preset is not applied — nothing changed."
          : `Removed. ${res.changed} change${res.changed === 1 ? "" : "s"} written, ` +
              `${res.revoked} entitlement${res.revoked === 1 ? "" : "s"} revoked.`,
      );
    });
  };

  const changes = mode?.data.changes ?? [];
  const hasChanges = changes.length > 0;
  const configChanges = changes.filter((c) => c.kind === "config");
  const grants = changes.filter((c) => c.kind === "feature");
  const revokes = changes.filter((c) => c.kind === "revoke");
  const themeChange = changes.find((c) => c.kind === "theme");
  const removing = mode?.kind === "remove";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Store preset</h3>
          <div className="card-sub">
            Stamp a whole store shape onto this tenant — layout, modules and entitlements.
            Additive: name, logo, colors, catalog and lab reports are never touched, and existing
            group-buy rules, copy and round defaults are kept as the owner set them. Removing
            switches the shape back off and revokes its entitlements; the theme, catalog and those
            same owner-edited rules and copy stay.
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
                <span style={{ display: "block", ...muted }}>{p.tagline}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => runPreview("apply")}
            disabled={pending}
          >
            {pending && !mode ? "Checking…" : "Preview changes"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => runPreview("remove")}
            disabled={pending}
          >
            Remove preset
          </button>

          {hasChanges && !removing && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={runApply}
              disabled={pending}
            >
              {pending ? "Applying…" : "Apply preset"}
            </button>
          )}
          {hasChanges && removing && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={runRemove}
              disabled={pending}
            >
              {pending ? "Removing…" : "Confirm removal"}
            </button>
          )}
        </div>

        {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
        {done && <div style={{ fontSize: 12, color: "var(--success, #137A50)" }}>{done}</div>}

        {mode && !hasChanges && (
          <div style={muted}>
            {removing ? (
              <>
                <strong>{mode.data.presetName}</strong> is not applied to this tenant. Nothing would
                change.
              </>
            ) : (
              <>
                This tenant already matches <strong>{mode.data.presetName}</strong>. Nothing would
                change.
              </>
            )}
          </div>
        )}

        {mode && hasChanges && (
          <div style={panel}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {changes.length} change{changes.length === 1 ? "" : "s"} to{" "}
              {removing ? "revert" : "apply"}
            </div>

            {themeChange?.kind === "theme" && (
              <div style={muted}>
                Theme: <span className="mono">{themeChange.from || "—"}</span> →{" "}
                <span className="mono">{themeChange.to}</span>
              </div>
            )}

            {configChanges.map((c) =>
              c.kind === "config" ? (
                <div key={c.key} style={muted}>
                  <span className="mono">{c.key}</span>: {short(c.from)} →{" "}
                  <strong>{c.to === undefined ? "cleared" : short(c.to)}</strong>
                </div>
              ) : null,
            )}

            {grants.length > 0 && (
              <div style={muted}>
                Grants:{" "}
                <span className="mono">
                  {grants.map((c) => (c.kind === "feature" ? c.key : "")).join(", ")}
                </span>
              </div>
            )}

            {revokes.length > 0 && (
              <div style={muted}>
                Revokes:{" "}
                <span className="mono">
                  {revokes.map((c) => (c.kind === "revoke" ? c.key : "")).join(", ")}
                </span>
              </div>
            )}

            {removing && (
              <div style={muted}>
                Kept: theme, catalog, lab reports, and the owner&rsquo;s group-buy rules, copy and
                round defaults.
              </div>
            )}

            {mode.kind === "remove" && mode.data.planGranted.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--warning, #9A6206)" }}>
                Included in this tenant&rsquo;s plan:{" "}
                <span className="mono">{mode.data.planGranted.join(", ")}</span>. Revoking writes a
                block that outlasts the preset — the store loses a feature it pays for until you
                re-enable it under Features.
              </div>
            )}

            {mode.kind === "apply" && mode.data.missingFeatures.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--warning, #9A6206)" }}>
                Not seeded in the feature catalog and will be skipped:{" "}
                <span className="mono">{mode.data.missingFeatures.join(", ")}</span>. Run{" "}
                <span className="mono">npm run db:sync-features</span>, then apply again.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
