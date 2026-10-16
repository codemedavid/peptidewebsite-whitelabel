import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { LoginResponse, MeResponse, RegisterRequest, StoreChoice, TokenPair } from "@contract";
import { ApiError, connectAuth, type RefreshOutcome } from "@/api/client";
import { authApi, meApi } from "@/api/endpoints";
import { forgetPushToken } from "@/notifications/push";
import {
  clearPendingLogout,
  clearSession,
  readCachedMe,
  readPendingLogout,
  readTokens,
  rememberEmail,
  writeCachedMe,
  writePendingLogout,
  writeTokens,
} from "./storage";

/**
 * The session state machine.
 *
 *   loading     → reading the Keychain on launch (splash stays up)
 *   signedOut   → Pepweb-branded sign-in (optionally with a notice)
 *   unreachable → a saved session, but nothing cached and the server can't be reached
 *   signedIn    → a store, an account, its permissions and its theme
 *
 * The TENANT is never chosen by the app: it is whatever the server says the
 * session belongs to (`me`). Everything cached is scoped by `scope`.
 *
 * Every async step captures the session EPOCH when it starts; signIn/signOut
 * bump it, and a step that finishes under a different epoch writes nothing. So
 * a slow /me or token refresh can never resurrect a session the user left.
 */

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut"; notice?: string }
  | { status: "unreachable" }
  | { status: "signedIn"; me: MeResponse; scope: string };

type SignedIn = { me: MeResponse; scope: string };

type SessionApi = {
  state: SessionState;
  /** The most recent signed-in value — lets screens render one last frame during sign-out teardown. */
  lastSignedIn: SignedIn | null;
  /**
   * Email + password (+ the store, once picked). Resolves to the list of
   * stores when this login opens more than one — nothing is signed in then.
   */
  signIn: (email: string, password: string, store?: string) => Promise<StoreChoice[] | null>;
  /** Create a customer account on a store; signs it straight in. */
  signUp: (details: RegisterRequest) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  reloadMe: () => Promise<void>;
  retry: () => void;
};

const SessionContext = createContext<SessionApi | null>(null);

// Mode is part of the scope: the same email can be a store's admin and its
// customer, and their cached data must never mix.
const scopeOf = (me: MeResponse) => `${me.store.slug}:${me.mode}:${me.actor.email.toLowerCase()}`;
const isOffline = (e: unknown) => e instanceof ApiError && (e.code === "network" || e.code === "timeout");

/** Retry a sign-out that couldn't reach the server earlier (stops stale pushes). */
async function flushPendingLogout(): Promise<void> {
  const pending = await readPendingLogout();
  if (!pending) return;
  try {
    await authApi.logout(pending.accessToken, pending.refreshToken);
    await clearPendingLogout();
  } catch (e) {
    if (!isOffline(e)) await clearPendingLogout(); // rejected = already gone server-side
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const tokens = useRef<TokenPair | null>(null);
  const refreshing = useRef<Promise<RefreshOutcome> | null>(null);
  const epoch = useRef(0);
  const signingOut = useRef(false);
  const [lastSignedIn, setLastSignedIn] = useState<SignedIn | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  /** Show `me` now and cache it for the next cold start. */
  const applyMe = useCallback(async (me: MeResponse, at: number) => {
    if (epoch.current !== at) return;
    const next = { me, scope: scopeOf(me) };
    setLastSignedIn(next);
    setState({ status: "signedIn", ...next });
    await writeCachedMe(me);
  }, []);

  const signOut = useCallback(
    async (notice?: string) => {
      if (signingOut.current) return;
      signingOut.current = true;
      epoch.current += 1;
      const current = tokens.current;
      tokens.current = null;
      refreshing.current = null;
      // UI first: the signed-in screens unmount before anything is torn down.
      setState({ status: "signedOut", notice });
      try {
        await Promise.all([clearSession(), forgetPushToken()]);
        queryClient.clear();
        if (current) {
          // Revokes the session and deletes this phone's push registration.
          await authApi.logout(current.accessToken, current.refreshToken).catch(async (e) => {
            if (isOffline(e)) await writePendingLogout(current);
          });
        }
      } finally {
        signingOut.current = false;
      }
    },
    [queryClient],
  );

  const refresh = useCallback((usedToken: string | null): Promise<RefreshOutcome> => {
    const current = tokens.current;
    if (!current) return Promise.resolve("rejected");
    // Another request already rotated the pair since this one was sent.
    if (usedToken && current.accessToken !== usedToken) return Promise.resolve("ok");
    if (refreshing.current) return refreshing.current;

    const at = epoch.current;
    const run = (async (): Promise<RefreshOutcome> => {
      try {
        const next = await authApi.refresh(current.refreshToken);
        if (epoch.current !== at) return "rejected";
        tokens.current = next;
        await writeTokens(next);
        return "ok";
      } catch (e) {
        return isOffline(e) ? "offline" : "rejected";
      }
    })();
    refreshing.current = run;
    void run.finally(() => {
      if (refreshing.current === run) refreshing.current = null;
    });
    return run;
  }, []);

  // Wire the HTTP client to this session.
  useEffect(() => {
    connectAuth({
      accessToken: () => tokens.current?.accessToken ?? null,
      accessExpiresAt: () => tokens.current?.accessExpiresAt ?? null,
      refresh,
      signOut: (message) => void signOut(message),
    });
    return () => connectAuth(null);
  }, [refresh, signOut]);

  // Launch: retry any pending logout, restore from the Keychain, open on the
  // cached store, then revalidate against the server.
  useEffect(() => {
    const at = epoch.current;
    void (async () => {
      await flushPendingLogout();
      const [saved, cachedMe] = await Promise.all([readTokens(), readCachedMe()]);
      if (epoch.current !== at) return;
      if (!saved || saved.refreshExpiresAt <= Date.now()) {
        await clearSession();
        setState({ status: "signedOut" });
        return;
      }
      tokens.current = saved;
      if (cachedMe) void applyMe(cachedMe, at);
      try {
        await applyMe(await meApi.get(), at);
      } catch {
        // Auth failures already signed out (epoch moved). Anything else with
        // nothing cached → a screen with Try again / Sign out, never a blank.
        if (epoch.current === at && !cachedMe) setState({ status: "unreachable" });
      }
    })();
  }, [applyMe, bootAttempt]);

  const reloadMe = useCallback(async () => {
    if (!tokens.current) return;
    const at = epoch.current;
    try {
      await applyMe(await meApi.get(), at);
    } catch {
      // Offline or signed out — both already handled.
    }
  }, [applyMe]);

  // Coming back to the app re-checks permissions and picks up a re-theme.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void reloadMe();
    });
    return () => sub.remove();
  }, [reloadMe]);

  /** Take over a session the server just issued (sign-in or sign-up). */
  const adopt = useCallback(
    async ({ me, ...pair }: LoginResponse, email: string) => {
      epoch.current += 1;
      const at = epoch.current;
      queryClient.clear();
      tokens.current = pair;
      // The server already signed us in: a keychain hiccup must not show the
      // login as failed. The session works now; it just won't survive a restart.
      await writeTokens(pair).catch((e: unknown) => console.warn("[session] could not save sign-in:", e));
      await rememberEmail(email.trim());
      await applyMe(me, at);
    },
    [applyMe, queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string, store?: string): Promise<StoreChoice[] | null> => {
      // Never make the login wait on an old sign-out retry (up to ~40s offline).
      void flushPendingLogout();
      const res = await authApi.login(store ? { store, email, password } : { email, password });
      if ("chooseStore" in res) return res.chooseStore;
      await adopt(res, email);
      return null;
    },
    [adopt],
  );

  const signUp = useCallback(
    async (details: RegisterRequest): Promise<void> => {
      void flushPendingLogout();
      await adopt(await authApi.register(details), details.email);
    },
    [adopt],
  );

  const value = useMemo<SessionApi>(
    () => ({
      state,
      lastSignedIn,
      signIn,
      signUp,
      signOut,
      reloadMe,
      retry: () => {
        setState({ status: "loading" });
        setBootAttempt((n) => n + 1);
      },
    }),
    [state, lastSignedIn, signIn, signUp, signOut, reloadMe],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

/**
 * The signed-in session. During the single frame of sign-out teardown it
 * returns the last signed-in value instead of crashing; no request can use it,
 * because the tokens are already gone.
 */
export function useSignedIn(): SignedIn {
  const { state, lastSignedIn } = useSession();
  if (state.status === "signedIn") return state;
  if (lastSignedIn) return lastSignedIn;
  throw new Error("useSignedIn outside a signed-in screen");
}
