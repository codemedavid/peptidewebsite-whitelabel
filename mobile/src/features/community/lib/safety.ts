import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Alert, Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CommunityMessage, Participant } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { APP_NAME, SAFETY_EMAIL } from "@/config";

/**
 * Community safety (App Store guideline 1.2): anyone can report a message, and
 * block a member so their messages disappear for them.
 *
 * Blocks live on this phone, per signed-in scope (store + mode + email), so a
 * block never leaks into another account. Reports go to the platform's safety
 * inbox by email, with the message and store identifiers we need to act.
 */

const keyOf = (scope: string) => `pepweb.blocked.v1:${scope}`;

let loadedScope: string | null = null;
let blocked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => blocked;

async function load(scope: string): Promise<void> {
  if (loadedScope === scope) return;
  loadedScope = scope;
  blocked = new Set();
  emit();
  try {
    const raw = await AsyncStorage.getItem(keyOf(scope));
    const keys = raw ? (JSON.parse(raw) as unknown) : [];
    if (loadedScope === scope && Array.isArray(keys)) {
      blocked = new Set(keys.filter((k): k is string => typeof k === "string"));
      emit();
    }
  } catch {
    // Unreadable list = nobody blocked; the next block rewrites it.
  }
}

async function save(scope: string, next: ReadonlySet<string>): Promise<void> {
  blocked = next;
  emit();
  await AsyncStorage.setItem(keyOf(scope), JSON.stringify([...next])).catch(() => undefined);
}

/** The members this account has blocked, plus block / unblock for them. */
export function useBlocked() {
  const { scope } = useSignedIn();
  useEffect(() => void load(scope), [scope]);
  const set = useSyncExternalStore(subscribe, snapshot, snapshot);

  const block = useCallback((key: string) => save(scope, new Set([...set, key])), [scope, set]);
  const unblock = useCallback(
    (key: string) => save(scope, new Set([...set].filter((k) => k !== key))),
    [scope, set],
  );
  return { blocked: set, isBlocked: (key: string | null | undefined) => !!key && set.has(key), block, unblock };
}

/** Messages from blocked members are dropped (the store team can't be blocked). */
export function withoutBlocked(messages: CommunityMessage[], blockedKeys: ReadonlySet<string>): CommunityMessage[] {
  if (blockedKeys.size === 0) return messages;
  return messages.filter((m) => !m.sender || m.sender.isTeam || !blockedKeys.has(m.sender.key));
}

/** Only other members — never yourself or the store team. */
export const canBlock = (person: Participant | null | undefined, myKey: string | null | undefined) =>
  !!person && !person.isTeam && person.key !== myKey;

/** Ask before blocking; resolves once the member is blocked (or the person cancels). */
export function confirmBlock(person: Participant, block: (key: string) => Promise<void>, after?: () => void): void {
  Alert.alert(
    `Block ${person.name}?`,
    "You won't see their messages in the community or in private chats. You can unblock them any time from their profile.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: () => {
          void block(person.key).then(after);
        },
      },
    ],
  );
}

type ReportContext = { storeName: string; storeSlug: string; reporterEmail: string };

/** Opens a pre-filled report email to the safety inbox; falls back to showing the address. */
export async function reportMessage(message: CommunityMessage, ctx: ReportContext): Promise<void> {
  const subject = `${APP_NAME} report: message in ${ctx.storeName}`;
  const body = [
    "Please tell us what's wrong with this message:",
    "",
    "",
    "— Details for our team (please keep) —",
    `Store: ${ctx.storeName} (${ctx.storeSlug})`,
    `Message ID: ${message.id}`,
    `Sent by: ${message.sender?.name ?? "unknown"} (${message.sender?.key ?? "n/a"})`,
    `Text: ${message.body ?? "(attachment)"}`,
    `Reported by: ${ctx.reporterEmail}`,
  ].join("\n");
  const url = `mailto:${SAFETY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Report this message", `Email ${SAFETY_EMAIL} with the message details. We review every report within 24 hours.`);
  }
}

// ── Community rules (accepted once per account on this phone) ────────────────

const rulesKeyOf = (scope: string) => `pepweb.communityRules.v1:${scope}`;
const rulesAccepted = new Map<string, boolean>();
const rulesListeners = new Set<() => void>();
const subscribeRules = (l: () => void) => {
  rulesListeners.add(l);
  return () => rulesListeners.delete(l);
};

/** null while loading; then whether this account agreed to the community rules here. */
export function useCommunityRules() {
  const { scope } = useSignedIn();
  const accepted = useSyncExternalStore(subscribeRules, () => rulesAccepted.get(scope) ?? null, () => rulesAccepted.get(scope) ?? null);
  useEffect(() => {
    if (rulesAccepted.has(scope)) return;
    void AsyncStorage.getItem(rulesKeyOf(scope))
      .catch(() => null)
      .then((v) => {
        rulesAccepted.set(scope, v === "yes");
        rulesListeners.forEach((l) => l());
      });
  }, [scope]);
  const accept = useCallback(() => {
    rulesAccepted.set(scope, true);
    rulesListeners.forEach((l) => l());
    void AsyncStorage.setItem(rulesKeyOf(scope), "yes").catch(() => undefined);
  }, [scope]);
  return { accepted, accept };
}

export const COMMUNITY_RULES = [
  "Be respectful. No harassment, hate speech, threats or bullying.",
  "No sexual, violent, illegal or otherwise objectionable content.",
  "No spam, scams or impersonation.",
  "Report anything that breaks these rules: long-press a message and tap Report. You can also block any member.",
  "We review reports within 24 hours, remove offending content and remove people who break the rules.",
];
