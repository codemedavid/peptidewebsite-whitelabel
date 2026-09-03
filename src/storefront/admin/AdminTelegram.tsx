"use client";

// Store-admin view (OWNER-ONLY) for the tenant's own Telegram order bot.
//
// The setup is deliberately a three-step walkthrough rather than a settings form,
// because the hard part isn't the fields — it's that the owner has to go to
// @BotFather first and come back with a token. Each step only appears once the
// one before it is satisfied, so the panel never shows a "generate code" button
// for a bot that doesn't exist yet.
//
// Nothing here ever displays the token. It goes one way: into
// saveTelegramTokenAction, which verifies it against Telegram, seals it and
// registers the webhook. The panel afterwards knows only "@somebot, connected".

import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import {
  loadTelegramPanelAction,
  saveTelegramTokenAction,
  setTelegramEnabledAction,
  disconnectTelegramAction,
  createTelegramPairingAction,
  unlinkTelegramRecipientAction,
  setTelegramRecipientFlagsAction,
  testTelegramConnectionAction,
  type RecipientView,
  type TelegramPanelState,
} from "@/actions/telegram";

export function AdminTelegram({ onBack }: { onBack: () => void }) {
  const { toast } = useStore();
  const [state, setState] = useState<TelegramPanelState | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);

  const reload = useCallback(async () => {
    const res = await loadTelegramPanelAction();
    if ("error" in res) {
      toast(res.error);
      return;
    }
    setState(res);
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<{ ok: true } | { error: string }>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if ("error" in res) {
        toast(res.error);
        return false;
      }
      toast(done);
      await reload();
      return true;
    } catch {
      toast("Couldn't reach the server — please retry.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const connected = !!state?.status?.configured;
  const enabled = !!state?.status?.enabled;
  const recipients = state?.recipients ?? [];

  const saveToken = async () => {
    const ok = await run(() => saveTelegramTokenAction(token), "Bot connected");
    if (ok) setToken("");
  };

  const makeCode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await createTelegramPairingAction();
      if ("error" in res) {
        toast(res.error);
        return;
      }
      setPairing({ code: res.code, expiresAt: res.expiresAt });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await testTelegramConnectionAction();
      toast("error" in res ? res.error : `Connected as @${res.botUsername}`);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin">
      <header className="admin-form__bar">
        <button className="admin-form__back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Dashboard
        </button>
        <h1 className="admin-form__title">
          <span style={{ fontSize: 20 }}>💬</span>
          Telegram Alerts
        </h1>
        <div className="admin-form__bar-spacer" />
      </header>

      <div className="admin-form__body">
        {/* ── Step 1 — the bot ──────────────────────────────────────────── */}
        <div className="admin-form__card">
          <h2 className="admin-form__section">1 · Connect your bot</h2>
          {connected ? (
            <>
              <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
                Connected as <strong>@{state?.status?.botUsername || "your bot"}</strong>
                {state?.status?.healthOk === false ? " — last check failed." : "."}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="admin-form__save" onClick={test} disabled={busy}>
                  Test connection
                </button>
                <button
                  className="admin-form__back"
                  onClick={() => run(disconnectTelegramAction, "Bot disconnected")}
                  disabled={busy}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
                In Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, pick a
                name, and paste the token it gives you below. The bot is yours — it carries your
                store&apos;s name, not ours.
              </div>
              <div className="admin-field" style={{ marginBottom: 12 }}>
                <label className="admin-field__label">Bot token</label>
                <input
                  className="admin-input"
                  type="password"
                  autoComplete="off"
                  value={token}
                  maxLength={200}
                  placeholder="123456789:AAE…"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                />
                <div className="admin-field__hint">
                  Stored encrypted and never shown again. Anyone with this token can post as your
                  bot, so don&apos;t paste it into a group chat.
                </div>
              </div>
              <button className="admin-form__save" onClick={saveToken} disabled={busy || !token.trim()}>
                {busy ? "Connecting…" : "Connect bot"}
              </button>
            </>
          )}
        </div>

        {/* ── Step 2 — who hears about orders ──────────────────────────── */}
        {connected && (
          <div className="admin-form__card">
            <h2 className="admin-form__section">2 · Choose who gets the alerts</h2>
            <div className="admin-field__hint" style={{ marginTop: -10, marginBottom: 14 }}>
              Generate a code, then send <code>/start CODE</code> to your bot from the chat that
              should receive orders. Only chats linked this way are ever messaged — and only the
              people linked here can confirm an order.
            </div>

            <button className="admin-form__save" onClick={makeCode} disabled={busy}>
              Generate linking code
            </button>

            {pairing && (
              <div className="admin-field" style={{ marginTop: 14 }}>
                <label className="admin-field__label">Send this to your bot</label>
                <div className="admin-input" style={{ fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }}>
                  /start {pairing.code}
                </div>
                <div className="admin-field__hint">
                  Valid once, and only until{" "}
                  {new Date(pairing.expiresAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  . Generate a new one if it expires.
                </div>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <h3 className="admin-form__section" style={{ fontSize: 14 }}>Linked chats</h3>
              {recipients.length === 0 ? (
                <div className="admin-field__hint">
                  No chats linked yet — nothing will be sent until at least one is.
                </div>
              ) : (
                recipients.map((r) => (
                  <RecipientRow
                    key={r.chatId}
                    recipient={r}
                    busy={busy}
                    onFlags={(flags) =>
                      run(() => setTelegramRecipientFlagsAction(r.chatId, flags), "Updated")
                    }
                    onUnlink={() =>
                      run(() => unlinkTelegramRecipientAction(r.chatId), "Chat unlinked")
                    }
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Step 3 — the switch ──────────────────────────────────────── */}
        {connected && (
          <div className="admin-form__card">
            <h2 className="admin-form__section">3 · Turn alerts on</h2>
            <div className="admin-field">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    run(
                      () => setTelegramEnabledAction(e.target.checked),
                      e.target.checked ? "Telegram alerts on" : "Telegram alerts off",
                    )
                  }
                />
                <span>Send every new order to Telegram</span>
              </label>
              <div className="admin-field__hint">
                When on, each order is pushed to your linked chats with a Confirm button. Confirming
                from Telegram does exactly what confirming here does — it deducts stock and moves the
                order forward.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One linked chat: what it is, what it may do, and how to remove it. */
function RecipientRow({
  recipient,
  busy,
  onFlags,
  onUnlink,
}: {
  recipient: RecipientView;
  busy: boolean;
  onFlags: (flags: { canConfirm?: boolean; showCustomerDetails?: boolean }) => void;
  onUnlink: () => void;
}) {
  const isGroup = recipient.chatType !== "private";
  return (
    <div className="admin-form__card" style={{ marginTop: 10, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>{recipient.label || recipient.chatId}</strong>
        {isGroup && <span className="admin-field__hint">· group</span>}
        <div style={{ flex: 1 }} />
        <button className="admin-form__back" onClick={onUnlink} disabled={busy}>
          Unlink
        </button>
      </div>

      <label className="admin-check">
        <input
          type="checkbox"
          checked={recipient.canConfirm}
          disabled={busy || isGroup}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onFlags({ canConfirm: e.target.checked })
          }
        />
        <span>Can confirm orders</span>
      </label>
      {isGroup && (
        <div className="admin-field__hint">
          A group can receive alerts but never confirm — a room isn&apos;t a person, so there is
          nobody to hold responsible for the press. Link someone&apos;s direct chat to give them
          confirm rights.
        </div>
      )}

      <label className="admin-check" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={recipient.showCustomerDetails}
          disabled={busy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onFlags({ showCustomerDetails: e.target.checked })
          }
        />
        <span>Include customer name, contact and address</span>
      </label>
      <div className="admin-field__hint">
        {isGroup
          ? "Off by default for groups — everyone in the chat would see the buyer's home address."
          : "The full order details, including who ordered and where it's going."}
      </div>
    </div>
  );
}
