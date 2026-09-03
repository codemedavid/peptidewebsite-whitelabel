"use client";

// Super-admin "Telegram order bot" card for one tenant.
//
// The operator connects the tenant's own @BotFather bot, links the chats that
// should receive orders, and switches alerts on. This is deliberately NOT a
// store-owner screen: the token can read everything the bot receives and post as
// the store, and registering a webhook points a third party at this deployment.
// It therefore lives beside the tenant's other third-party credentials.
//
// The token goes one way. Nothing renders it back — the panel only ever knows
// "@somebot, connected".

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  loadTelegramPanelAction,
  saveTelegramTokenAction,
  setTelegramEnabledAction,
  disconnectTelegramAction,
  createTelegramPairingAction,
  unlinkTelegramRecipientAction,
  setTelegramRecipientFlagsAction,
  testTelegramConnectionAction,
  registerTelegramWebhookAction,
  getTelegramWebhookTargetAction,
  type RecipientView,
  type TelegramPanelState,
} from "@/actions/admin-telegram";

type Note = { kind: "ok" | "err"; text: string } | null;

export function AdminTelegramBot({
  slug,
  entitled,
  demo,
}: {
  slug: string;
  entitled: boolean;
  demo?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<TelegramPanelState | null>(null);
  const [token, setToken] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  // The callback URL this deployment would register. Shown because when it can't
  // be registered, the URL itself is the explanation.
  const [target, setTarget] = useState<{ url: string; issue: string | null } | null>(null);

  const reload = useCallback(async () => {
    const res = await loadTelegramPanelAction(slug);
    if ("error" in res) {
      // FORBIDDEN is the guard talking to a logged-out tab; everything else is
      // worth showing (most usefully: "run db:push").
      if (res.error !== "FORBIDDEN") setNote({ kind: "err", text: res.error });
      return;
    }
    setState(res);
  }, [slug]);

  useEffect(() => {
    if (demo) return;
    void reload();
    void getTelegramWebhookTargetAction(slug).then((r) => {
      if (!("error" in r)) setTarget(r);
    });
  }, [reload, demo, slug]);

  const run = (fn: () => Promise<{ ok: true } | { error: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      setNote("error" in res ? { kind: "err", text: res.error } : { kind: "ok", text: ok });
      await reload();
    });

  const configured = !!state?.status?.configured;
  const enabled = !!state?.status?.enabled;
  const recipients = state?.recipients ?? [];
  const locked = !entitled || !!demo;

  return (
    <div
      className="card"
      style={{ marginTop: 16, opacity: locked ? 0.55 : 1, pointerEvents: locked ? "none" : "auto" }}
    >
      <div
        className="card-head"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 14 }}>Telegram order bot</strong>
          <span className="badge">
            <span className="bdot" style={{ background: configured ? (enabled ? "#16a34a" : "#d97706") : "#94a3b8" }} />
            {configured ? (enabled ? "Alerts on" : "Connected, alerts off") : "Not connected"}
          </span>
        </span>
        {configured && state?.status?.botUsername && (
          <span style={{ fontSize: 12, color: "var(--ink-500)" }}>@{state.status.botUsername}</span>
        )}
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
        {demo ? (
          <p style={{ fontSize: 13, color: "var(--ink-500)", margin: 0 }}>
            The Telegram bot isn&apos;t available for built-in demo tenants.
          </p>
        ) : !entitled ? (
          <p style={{ fontSize: 13, color: "var(--ink-500)", margin: 0 }}>
            This tenant isn&apos;t entitled to Telegram notifications. Grant{" "}
            <code>notify.telegram</code> on the Features tab first.
          </p>
        ) : (
          <>
            {note && (
              <div
                style={{
                  fontSize: 13,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: note.kind === "ok" ? "#f0fdf4" : "#fef2f2",
                  color: note.kind === "ok" ? "#166534" : "#991b1b",
                }}
              >
                {note.text}
              </div>
            )}

            {/* ── 1. the bot ─────────────────────────────────────────────── */}
            <Field
              label="Bot token"
              hint={
                configured
                  ? "A token is stored (hidden). Paste a new one to replace it — the webhook URL is preserved."
                  : "In Telegram, message @BotFather → /newbot → copy the token it returns."
              }
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="123456789:AAE…"
                  value={token}
                  maxLength={200}
                  onChange={(e) => setToken(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn"
                  disabled={pending || !token.trim()}
                  onClick={() =>
                    run(async () => {
                      const r = await saveTelegramTokenAction(slug, token);
                      if (!("error" in r)) setToken("");
                      return r;
                    }, "Bot connected and webhook registered")
                  }
                >
                  {configured ? "Replace" : "Connect"}
                </button>
              </div>
            </Field>

            {target && (
              <div style={{ fontSize: 12, color: "var(--ink-500)", lineHeight: 1.6 }}>
                <div>
                  Callback URL:{" "}
                  <code style={{ fontSize: 11 }}>{target.url}</code>
                </div>
                {target.issue && (
                  <div style={{ color: "#b45309", marginTop: 4 }}>
                    ⚠ {target.issue} The token still saves; register the callback from a
                    deployed environment.
                  </div>
                )}
              </div>
            )}

            {configured && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await testTelegramConnectionAction(slug);
                      setNote(
                        "error" in r
                          ? { kind: "err", text: r.error }
                          : { kind: "ok", text: `Connected as @${r.botUsername}` },
                      );
                      await reload();
                    })
                  }
                >
                  Test connection
                </button>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() =>
                    run(() => registerTelegramWebhookAction(slug), "Webhook registered")
                  }
                >
                  Re-register webhook
                </button>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => run(() => disconnectTelegramAction(slug), "Bot disconnected")}
                >
                  Disconnect
                </button>
              </div>
            )}

            {/* ── 2. recipients ──────────────────────────────────────────── */}
            {configured && (
              <Field
                label="Who receives orders"
                hint="Generate a code, then send “/start CODE” to the bot from the chat that should get alerts. Only linked chats are ever messaged, and only linked people can confirm."
              >
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await createTelegramPairingAction(slug);
                      if ("error" in r) setNote({ kind: "err", text: r.error });
                      else setPairing({ code: r.code, expiresAt: r.expiresAt });
                    })
                  }
                >
                  Generate linking code
                </button>

                {pairing && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "10px 14px",
                      borderRadius: 6,
                      background: "var(--paper-100, #f8fafc)",
                      fontFamily: "monospace",
                      fontSize: 16,
                      letterSpacing: 1,
                    }}
                  >
                    /start {pairing.code}
                    <div
                      style={{
                        fontFamily: "inherit",
                        fontSize: 12,
                        letterSpacing: 0,
                        color: "var(--ink-500)",
                        marginTop: 4,
                      }}
                    >
                      Single use, expires{" "}
                      {new Date(pairing.expiresAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      .
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {recipients.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--ink-500)", margin: 0 }}>
                      No chats linked — nothing is sent until at least one is.
                    </p>
                  ) : (
                    recipients.map((r) => (
                      <RecipientRow
                        key={r.chatId}
                        r={r}
                        pending={pending}
                        onFlags={(flags) =>
                          run(
                            () => setTelegramRecipientFlagsAction(slug, r.chatId, flags),
                            "Recipient updated",
                          )
                        }
                        onUnlink={() =>
                          run(
                            () => unlinkTelegramRecipientAction(slug, r.chatId),
                            "Chat unlinked",
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </Field>
            )}

            {/* ── 3. the switch ──────────────────────────────────────────── */}
            {configured && (
              <Field
                label="Order alerts"
                hint="When on, every new order is pushed to the linked chats with a Confirm button. Confirming from Telegram deducts stock and moves the order forward exactly as the store admin does."
              >
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={pending}
                    onChange={(e) =>
                      run(
                        () => setTelegramEnabledAction(slug, e.target.checked),
                        e.target.checked ? "Telegram alerts on" : "Telegram alerts off",
                      )
                    }
                  />
                  Send new orders to Telegram
                </label>
              </Field>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecipientRow({
  r,
  pending,
  onFlags,
  onUnlink,
}: {
  r: RecipientView;
  pending: boolean;
  onFlags: (flags: { canConfirm?: boolean; showCustomerDetails?: boolean }) => void;
  onUnlink: () => void;
}) {
  const isGroup = r.chatType !== "private";
  return (
    <div
      style={{
        border: "1px solid var(--line-200, #e2e8f0)",
        borderRadius: 6,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{r.label || r.chatId}</strong>
        {isGroup && <span style={{ fontSize: 12, color: "var(--ink-500)" }}>· group</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={pending} onClick={onUnlink}>
          Unlink
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={r.canConfirm}
          disabled={pending || isGroup}
          onChange={(e) => onFlags({ canConfirm: e.target.checked })}
        />
        Can confirm orders
        {isGroup && (
          <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
            — a group can&apos;t confirm; there is nobody to hold responsible
          </span>
        )}
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={r.showCustomerDetails}
          disabled={pending}
          onChange={(e) => onFlags({ showCustomerDetails: e.target.checked })}
        />
        Include customer name, contact and address
        {isGroup && (
          <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
            — off by default for groups
          </span>
        )}
      </label>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && (
        <span style={{ fontSize: 12, color: "var(--ink-500)", lineHeight: 1.5 }}>{hint}</span>
      )}
    </div>
  );
}
