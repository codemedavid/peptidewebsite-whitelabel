import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "./secure-store";
import type { MeResponse, StorePreview, TokenPair } from "@contract";

/**
 * On-device persistence, split by sensitivity:
 *   - tokens → SecureStore (iOS Keychain / Android Keystore), this device only;
 *   - the last /me (store identity, permissions, theme — no secrets) →
 *     AsyncStorage, so the app can open straight into the right store's
 *     branding instead of flashing the neutral one;
 *   - recent store addresses (for one-tap sign-in) → AsyncStorage.
 * Signing out clears the first two.
 */

const TOKENS_KEY = "pepweb.tokens.v1";
// Bump whenever MeResponse gains a field the app reads unconditionally: a copy
// cached by an older build is then ignored (the app waits for the live /me)
// instead of rendering with the field missing. v2 = mode + community.
const ME_KEY = "pepweb.me.v2";
const STALE_ME_KEYS = ["pepweb.me.v1"];
const LAST_EMAIL_KEY = "pepweb.lastEmail.v1";

export async function readTokens(): Promise<TokenPair | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    const t = raw ? (JSON.parse(raw) as TokenPair) : null;
    return t?.accessToken && t.refreshToken ? t : null;
  } catch {
    return null;
  }
}

export async function writeTokens(tokens: TokenPair): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function readCachedMe(): Promise<MeResponse | null> {
  try {
    const raw = await AsyncStorage.getItem(ME_KEY);
    if (!raw) return null;
    const me = JSON.parse(raw) as Partial<MeResponse>;
    // Belt and braces on top of the versioned key: never render a partial copy.
    return me.store && me.actor && me.can && me.mode && me.community ? (me as MeResponse) : null;
  } catch {
    return null;
  }
}

export async function writeCachedMe(me: MeResponse): Promise<void> {
  await AsyncStorage.setItem(ME_KEY, JSON.stringify(me)).catch(() => undefined);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKENS_KEY).catch(() => undefined),
    AsyncStorage.multiRemove([ME_KEY, ...STALE_ME_KEYS]).catch(() => undefined),
  ]);
}

// ── pending server logout ────────────────────────────────────────────────────
// A sign-out that couldn't reach the server keeps the old tokens ONLY so the
// revoke (which also stops that store's push alerts) can be retried later.

const PENDING_LOGOUT_KEY = "pepweb.pendingLogout.v1";

export async function readPendingLogout(): Promise<TokenPair | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_LOGOUT_KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    return null;
  }
}

export async function writePendingLogout(tokens: TokenPair): Promise<void> {
  await SecureStore.setItemAsync(PENDING_LOGOUT_KEY, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  }).catch(() => undefined);
}

export async function clearPendingLogout(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_LOGOUT_KEY).catch(() => undefined);
}

/** The last email that signed in on this phone — prefilled on the sign-in screen. */
export async function readLastEmail(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(LAST_EMAIL_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function rememberEmail(email: string): Promise<void> {
  const clean = email.trim();
  if (clean) await AsyncStorage.setItem(LAST_EMAIL_KEY, clean).catch(() => undefined);
}

// ── linked store ─────────────────────────────────────────────────────────────
// The store a shared app link (or typed store code) tied this phone to. Kept
// across sign-outs — it's the seller the customer came from, not a session.
// Public data only (what the store's website shows anyone).

const LINKED_STORE_KEY = "pepweb.linkedStore.v1";

export async function readLinkedStore(): Promise<StorePreview | null> {
  try {
    const raw = await AsyncStorage.getItem(LINKED_STORE_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<StorePreview>) : null;
    return s?.slug && s.name && s.address && s.theme?.palette ? (s as StorePreview) : null;
  } catch {
    return null;
  }
}

export async function writeLinkedStore(store: StorePreview | null): Promise<void> {
  await (store
    ? AsyncStorage.setItem(LINKED_STORE_KEY, JSON.stringify(store))
    : AsyncStorage.removeItem(LINKED_STORE_KEY)
  ).catch(() => undefined);
}
