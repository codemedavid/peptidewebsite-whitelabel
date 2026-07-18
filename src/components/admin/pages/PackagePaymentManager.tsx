"use client";

// Super Admin editor for the get-started checkout payment details — the
// platform's OWN receiving accounts a new client pays their package to.
// Edits are local until "Save changes"; saving persists via the
// savePackagePaymentAction (demo file / platform_settings row).

import { useRef, useState, useTransition } from "react";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { uploadOnboardingImage } from "@/components/onboarding/useOnboardingForm";
import { savePackagePaymentAction } from "@/actions/admin-package-payment";
import type {
  PackagePaymentConfig,
  PackagePaymentMethod,
} from "@/lib/platform/package-payment";

let nextId = 0;
function newMethod(): PackagePaymentMethod {
  nextId += 1;
  return { id: `pp-new-${nextId}`, method: "", account: "", number: "", note: "", qrUrl: "", active: true };
}

const MAX_METHODS = 12;

export function PackagePaymentManager({ initial }: { initial: PackagePaymentConfig }) {
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [instructions, setInstructions] = useState(initial.instructions);
  const [methods, setMethods] = useState<PackagePaymentMethod[]>(initial.methods);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchMethod(id: string, patch: Partial<PackagePaymentMethod>) {
    setMethods((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setDirty(true);
  }

  function move(id: string, dir: -1 | 1) {
    setMethods((ms) => {
      const i = ms.findIndex((m) => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ms.length) return ms;
      const next = [...ms];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  function remove(id: string) {
    setMethods((ms) => ms.filter((m) => m.id !== id));
    setDirty(true);
  }

  function add() {
    setMethods((ms) => (ms.length >= MAX_METHODS ? ms : [...ms, newMethod()]));
    setDirty(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePackagePaymentAction({ instructions, methods });
      if ("error" in res) {
        setError(res.error);
        showToast(res.error);
      } else {
        setDirty(false);
        showToast("Checkout payment details saved.");
      }
    });
  }

  const activeCount = methods.filter((m) => m.active && m.method.trim()).length;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <h1 className="page-title">Checkout Payments</h1>
          <p className="page-sub">
            Your receiving accounts shown on the public <span className="mono">/get-started</span>{" "}
            checkout — where new clients pay for their package.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {dirty && <span className="badge badge-warn">Unsaved changes</span>}
          <button className="btn btn-accent" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--danger)" }}>
          <div className="card-body" style={{ padding: 14, fontSize: 13, color: "var(--danger)" }}>
            <Ic.AlertCircle style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
            {error}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">Checkout instructions</h3>
            <div className="card-sub">Shown above the payment methods on the checkout step.</div>
          </div>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          <textarea
            className="input"
            rows={3}
            style={{ width: "100%", resize: "vertical", lineHeight: 1.5 }}
            value={instructions}
            maxLength={1000}
            onChange={(e) => {
              setInstructions(e.target.value);
              setDirty(true);
            }}
            placeholder="Pay your selected package using any method below…"
          />
        </div>
      </div>

      {/* Methods */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">
              <Ic.Card style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
              Payment methods
            </h3>
            <div className="card-sub">
              {activeCount} active · inactive methods stay saved but are hidden from clients.
            </div>
          </div>
          <button className="btn btn-sm" onClick={add} disabled={methods.length >= MAX_METHODS}>
            <Ic.Plus /> Add method
          </button>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          {methods.length === 0 ? (
            <div style={{ padding: "28px 0", textAlign: "center", color: "var(--ink-400)", fontSize: 13 }}>
              No payment methods yet — add one so clients can pay for their package.
            </div>
          ) : (
            <div className="col" style={{ gap: 14 }}>
              {methods.map((m, i) => (
                <MethodCard
                  key={m.id}
                  method={m}
                  first={i === 0}
                  last={i === methods.length - 1}
                  onPatch={(p) => patchMethod(m.id, p)}
                  onMove={(dir) => move(m.id, dir)}
                  onRemove={() => remove(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── one editable method ── */
function MethodCard({
  method: m,
  first,
  last,
  onPatch,
  onMove,
  onRemove,
}: {
  method: PackagePaymentMethod;
  first: boolean;
  last: boolean;
  onPatch: (p: Partial<PackagePaymentMethod>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border-c)",
        borderRadius: 10,
        padding: 16,
        background: "var(--bg-canvas)",
        opacity: m.active ? 1 : 0.6,
      }}
    >
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 160, fontWeight: 600 }}
          value={m.method}
          maxLength={120}
          placeholder="Method name — e.g. GCash"
          onChange={(e) => onPatch({ method: e.target.value })}
        />
        <button
          className="btn btn-sm"
          onClick={() => onPatch({ active: !m.active })}
          aria-label={m.active ? "Deactivate method" : "Activate method"}
        >
          <Ic.Eye />
          {m.active ? "Active" : "Hidden"}
        </button>
        <button className="btn btn-sm" onClick={() => onMove(-1)} disabled={first} aria-label="Move up">
          <Ic.ArrowUp />
        </button>
        <button className="btn btn-sm" onClick={() => onMove(1)} disabled={last} aria-label="Move down">
          <Ic.ArrowDown />
        </button>
        <button className="btn btn-sm btn-danger" onClick={onRemove} aria-label="Remove method">
          <Ic.Trash />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="field-label">Account name</label>
          <input
            className="input"
            style={{ width: "100%", marginTop: 4 }}
            value={m.account}
            maxLength={200}
            placeholder="e.g. Pepweb"
            onChange={(e) => onPatch({ account: e.target.value })}
          />
        </div>
        <div>
          <label className="field-label">Account / reference number</label>
          <input
            className="input"
            style={{ width: "100%", marginTop: 4 }}
            value={m.number}
            maxLength={200}
            placeholder="e.g. 0917 123 4567"
            onChange={(e) => onPatch({ number: e.target.value })}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="field-label">Note for the client</label>
        <input
          className="input"
          style={{ width: "100%", marginTop: 4 }}
          value={m.note}
          maxLength={500}
          placeholder="e.g. Scan the QR, then screenshot the receipt."
          onChange={(e) => onPatch({ note: e.target.value })}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="field-label">QR code (optional)</label>
        <QrUpload value={m.qrUrl} onChange={(qrUrl) => onPatch({ qrUrl })} />
      </div>
    </div>
  );
}

/* ── QR upload: reuses the public onboarding upload endpoint (ImageKit / data URL) ── */
function QrUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      onChange(await uploadOnboardingImage(file, "payment-qr"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 12, marginTop: 4, alignItems: "flex-start" }}>
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Payment QR code"
            style={{
              width: 96,
              height: 96,
              objectFit: "contain",
              borderRadius: 8,
              border: "1px solid var(--border-c)",
              background: "#fff",
            }}
          />
          <button className="btn btn-sm" onClick={() => onChange("")}>
            <Ic.X /> Remove
          </button>
        </>
      ) : (
        <button className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Ic.Image /> {busy ? "Uploading…" : "Upload QR image"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {err && <span style={{ fontSize: 12, color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}
