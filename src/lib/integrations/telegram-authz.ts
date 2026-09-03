// Who may hear about an order, and who may confirm one.
//
// This module is the whole authorization core of the Telegram bot, and it is
// deliberately PURE: rows in, decision out, no DB and no I/O. Everything that
// decides whether a stranger in a chat can move a real order lives here where it
// can be exercised directly.
//
// The rule is that authorization is a ROW, never a chat. A person may press
// Confirm only when the tenant has a linked recipient row that names their
// numeric Telegram user id and carries `canConfirm`. Being in the chat where the
// alert landed proves nothing — group members, forwarded messages and anyone who
// guesses a callback payload all fail here.

import { timingSafeEqual } from "node:crypto";

/** One chat that has completed the pairing handshake for a tenant. */
export interface LinkedRecipient {
  /** Telegram chat id, as a string (they exceed 2^53 for some chat types). */
  chatId: string;
  /**
   * The Telegram USER id that linked this chat, when there is exactly one.
   * Null for a group: a group is a room, not a person, so no single user id can
   * stand for it — and a null here must never authorize anybody (see below).
   */
  telegramUserId: string | null;
  /** Whether presses from this recipient may move an order to confirmed. */
  canConfirm: boolean;
  /** Display label for the owner's recipient list (@username or a chat title). */
  label: string;
}

/**
 * The recipient allowed to confirm on behalf of `telegramUserId`, or null.
 *
 * The null-handling is the point of this function. A group row stores
 * `telegramUserId: null`, and a malformed callback can arrive with no user at
 * all — so a loose `r.telegramUserId === userId` comparison would match null to
 * null and hand confirm rights to any presser in any chat. Both sides are
 * therefore required to be non-empty strings before they are compared, and the
 * comparison is exact: ids are opaque strings, so "0555" is not "555".
 */
export function findConfirmer(
  recipients: readonly LinkedRecipient[],
  telegramUserId: string | null | undefined,
): LinkedRecipient | null {
  const presser = typeof telegramUserId === "string" ? telegramUserId.trim() : "";
  // Fail closed on anything that isn't a real id — including the literal
  // "null"/"undefined" a sloppy string coercion upstream could produce.
  if (!presser || presser === "null" || presser === "undefined") return null;

  return (
    recipients.find((r) => {
      if (!r.canConfirm) return false;
      const owner = typeof r.telegramUserId === "string" ? r.telegramUserId.trim() : "";
      if (!owner) return false; // a group row can never authorize a press
      return owner === presser;
    }) ?? null
  );
}

/**
 * Every chat that should receive a new-order alert. Confirm rights are NOT a
 * filter here on purpose: a packer who may see orders but not confirm them is a
 * normal arrangement, and it is `findConfirmer` that stops their press.
 */
export function alertTargets(recipients: readonly LinkedRecipient[]): string[] {
  return recipients.map((r) => r.chatId).filter((id) => !!id);
}

/**
 * Constant-time comparison of the `X-Telegram-Bot-Api-Secret-Token` header
 * against the secret this tenant registered with setWebhook.
 *
 * Fails CLOSED on an empty expectation: a tenant with no secret stored must not
 * accept every forged update because "" happens to equal "". Length mismatches
 * short-circuit before timingSafeEqual (which throws on unequal buffers) — the
 * length of a secret is not the part worth hiding.
 */
export function verifyWebhookSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = typeof provided === "string" ? provided : "";
  const b = typeof expected === "string" ? expected : "";
  if (!a || !b) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** What a chat is allowed to do the moment it completes the pairing handshake. */
export interface RecipientLinkDefaults {
  telegramUserId: string | null;
  canConfirm: boolean;
  showCustomerDetails: boolean;
}

/**
 * Decide a newly linked chat's permissions from its type and whoever redeemed
 * the code. Pure, and the single definition of the group rule.
 *
 * The important correction here: a GROUP records the linking user just as a
 * private chat does. The first cut nulled it, reasoning that "a room is not a
 * person" — but Telegram reports `callback_query.from.id` on every press,
 * including in groups, so the presser is always identifiable and the linker is
 * always accountable. Discarding the id did not implement "only specific people
 * may confirm"; it implemented "nobody may", and locked the owner out of the
 * group they had just linked.
 *
 * A chat is therefore a DELIVERY target, and authorization is a PERSON. Other
 * members of the group are still refused (their ids match no row), and any
 * additional staffer can be authorized by redeeming a code in their own DM.
 *
 * PII redaction stays a separate decision and still defaults OFF for a group: a
 * group is a room full of people the buyer never agreed to share an address with,
 * which is true regardless of who is allowed to press a button.
 */
export function recipientLinkDefaults(
  chatType: string,
  linkerUserId: string | null | undefined,
): RecipientLinkDefaults {
  const isPrivate = chatType === "private";
  const linker = typeof linkerUserId === "string" ? linkerUserId.trim() : "";
  return {
    // Empty stays NULL — an unidentifiable link must authorize nobody, which
    // findConfirmer enforces.
    telegramUserId: linker || null,
    canConfirm: true,
    showCustomerDetails: isPrivate,
  };
}
