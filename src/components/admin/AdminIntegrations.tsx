"use client";

// Super-admin "Integrations" card for one tenant. Today it manages PostHog: the
// operator pastes the tenant's project key, tests the connection, and toggles it
// on. The actual checkout/delivery EMAILS are built inside that tenant's PostHog
// project (workflows + email channel) — the checklist at the bottom is the runbook
// for that. The plaintext key never leaves the server; we only ever show status.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  savePostHogKeyAction,
  setPostHogEnabledAction,
  testPostHogConnectionAction,
} from "@/actions/admin-integrations";

export interface PostHogStatusView {
  configured: boolean;
  enabled: boolean;
  host: string;
  healthOk: boolean | null;
  lastHealthCheckAt: string | null;
}

interface AdminIntegrationsProps {
  slug: string;
  name: string;
  entitled: boolean;
  status: PostHogStatusView | null;
  demo?: boolean;
}

const DEFAULT_HOST = "https://us.i.posthog.com";

type Note = { kind: "ok" | "err"; text: string } | null;

export function AdminIntegrations({ slug, name, entitled, status, demo }: AdminIntegrationsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [keyInput, setKeyInput] = useState("");
  const [host, setHost] = useState(status?.host || DEFAULT_HOST);
  const [note, setNote] = useState<Note>(null);

  const configured = !!status?.configured;
  const enabled = !!status?.enabled;

  function run(
    fn: () => Promise<{ ok?: true; error?: string; healthy?: boolean }>,
    okText: string,
  ) {
    setNote(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res && res.error) {
        setNote({ kind: "err", text: res.error });
        return;
      }
      const failedTest = "healthy" in res && res.healthy === false;
      const text =
        "healthy" in res
          ? res.healthy
            ? "Connection OK — events are reaching PostHog."
            : "Connected, but PostHog rejected the test event. Check the key/host."
          : okText;
      setNote({ kind: failedTest ? "err" : "ok", text });
      router.refresh();
    });
  }

  return (
    <div className="page-inner">
      <div className="page-head" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Integrations</h1>
          <p style={{ fontSize: 13, color: "var(--ink-500)", margin: 0 }}>
            {name} — connect this store to external analytics &amp; messaging.
          </p>
        </div>
      </div>

      {!entitled && (
        <div className="card" style={{ marginBottom: 16, padding: 18 }}>
          <strong style={{ fontSize: 14 }}>PostHog analytics is on the Automated Growth plan.</strong>
          <p style={{ fontSize: 13, color: "var(--ink-500)", margin: "6px 0 0" }}>
            This tenant isn&apos;t entitled to PostHog analytics. Grant the feature on the
            Features tab (or upgrade the plan) to connect a project and drive
            checkout/delivery emails.
          </p>
        </div>
      )}

      <div
        className="card"
        style={{ opacity: entitled ? 1 : 0.55, pointerEvents: entitled ? "auto" : "none" }}
      >
        <div
          className="card-head"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 14 }}>PostHog</strong>
            <StatusBadge configured={configured} enabled={enabled} />
          </span>
          <HealthBadge healthOk={status?.healthOk ?? null} at={status?.lastHealthCheckAt ?? null} />
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {demo ? (
            <p style={{ fontSize: 13, color: "var(--ink-500)", margin: 0 }}>
              Integrations aren&apos;t available for built-in demo tenants.
            </p>
          ) : (
            <>
              <Field
                label="Project API key"
                hint={
                  configured
                    ? "A key is stored (hidden). Paste a new one to replace it."
                    : "From PostHog → Settings → Project → Project API Key (phc_…)."
                }
              >
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={configured ? "•••••••••• (stored)" : "phc_xxxxxxxxxxxxxxxx"}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
              </Field>

              <Field
                label="Host"
                hint="US cloud by default. Use https://eu.i.posthog.com for EU, or your self-hosted URL."
              >
                <input
                  className="input"
                  type="url"
                  placeholder={DEFAULT_HOST}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </Field>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  disabled={pending || keyInput.trim().length < 10}
                  onClick={() =>
                    run(() => savePostHogKeyAction(slug, { projectApiKey: keyInput, host }), "Key saved.")
                  }
                >
                  {configured ? "Replace key" : "Save key"}
                </button>
                <button
                  className="btn"
                  disabled={pending || !configured}
                  onClick={() => run(() => testPostHogConnectionAction(slug), "Tested.")}
                >
                  Test connection
                </button>
                <button
                  className="btn"
                  disabled={pending || !configured}
                  onClick={() =>
                    run(() => setPostHogEnabledAction(slug, !enabled), enabled ? "Disabled." : "Enabled.")
                  }
                  style={enabled ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                >
                  {enabled ? "Disable" : "Enable"}
                </button>
              </div>

              {note && (
                <p
                  role="status"
                  style={{
                    fontSize: 12.5,
                    margin: 0,
                    color: note.kind === "ok" ? "var(--success, #16a34a)" : "var(--destructive, #dc2626)",
                  }}
                >
                  {note.text}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* The email logic lives in PostHog — this is the operator runbook. */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <strong style={{ fontSize: 14 }}>Set up emails inside PostHog</strong>
        </div>
        <ol
          style={{
            margin: 0,
            padding: "16px 18px 18px 34px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 13,
            color: "var(--ink-600)",
          }}
        >
          <li>In the tenant&apos;s PostHog project, verify a sending domain (Messaging → Channels → Email).</li>
          <li>
            Set the channel <em>from name</em> and <em>from email</em> (e.g. {name} &lt;orders@store.com&gt;).
          </li>
          <li>
            Build a workflow triggered by <code>order_placed</code> → send the order-confirmation email
            (the buyer&apos;s <code>email</code> is on the person via <code>$set</code>).
          </li>
          <li>
            Build a workflow triggered by <code>order_status_changed</code> where <code>toStatus</code> is{" "}
            <code>shipped</code> or <code>delivered</code> → send the shipping/delivery email.
          </li>
          <li>Enable the integration above so this store starts emitting those events.</li>
        </ol>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: "var(--ink-400)" }}>{hint}</span>}
    </label>
  );
}

function StatusBadge({ configured, enabled }: { configured: boolean; enabled: boolean }) {
  const label = !configured ? "Not configured" : enabled ? "Enabled" : "Disabled";
  const color = !configured ? "var(--ink-400)" : enabled ? "var(--success, #16a34a)" : "var(--ink-500)";
  return (
    <span className="badge" style={{ color }}>
      <span className="bdot" /> {label}
    </span>
  );
}

function HealthBadge({ healthOk, at }: { healthOk: boolean | null; at: string | null }) {
  if (healthOk === null) return null;
  const when = at ? new Date(at).toLocaleString() : "";
  return (
    <span
      style={{
        fontSize: 11.5,
        color: healthOk ? "var(--success, #16a34a)" : "var(--destructive, #dc2626)",
      }}
    >
      {healthOk ? "✓ healthy" : "✗ failed"}
      {when ? ` · ${when}` : ""}
    </span>
  );
}
