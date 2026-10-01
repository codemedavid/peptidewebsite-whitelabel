import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import type { StorePreview } from "@contract";
import { ApiError } from "@/api/client";
import { storesApi } from "@/api/endpoints";
import { readLinkedStore, writeLinkedStore } from "@/auth/storage";
import { useSession } from "@/auth/SessionProvider";
import { onStoreLink, takePendingStoreLink } from "./pending";

/**
 * The phone's LINKED STORE — which seller a customer came from.
 *
 * The app is shared by every store, so an install alone can't say which one.
 * The seller's link (https://<store>/app → pepwebadmin://store/<slug>) or the
 * store code typed into "Add your store" links the phone to that store:
 *   - sign-in is sent with `store`, so the server checks the login against
 *     THAT store only (and a customer lands in the right shop);
 *   - the signed-out screens wear the store's branding.
 *
 * This is a hint, never an authority: the server resolves the store again on
 * every lookup and sign-in, and the session it issues is what binds the phone
 * to the tenant.
 */

type StoreLinkApi = {
  linked: StorePreview | null;
  /** The saved link has been read (the splash waits for it — no Pepweb flash). */
  ready: boolean;
  /** Look up a link or store code and link it. Throws ApiError with a showable message. */
  link: (identifier: string) => Promise<StorePreview>;
  unlink: () => Promise<void>;
};

const StoreLinkContext = createContext<StoreLinkApi | null>(null);

export function StoreLinkProvider({ children }: { children: ReactNode }) {
  const { state, signOut } = useSession();
  const [linked, setLinked] = useState<StorePreview | null>(null);
  const [ready, setReady] = useState(false);
  // Read inside the deep-link handler without re-subscribing on every change.
  const sessionRef = useRef(state);
  useEffect(() => {
    sessionRef.current = state;
  }, [state]);

  const save = useCallback(async (store: StorePreview | null) => {
    setLinked(store);
    await writeLinkedStore(store);
  }, []);

  const link = useCallback(
    async (identifier: string) => {
      const store = await storesApi.preview(identifier);
      await save(store);
      return store;
    },
    [save],
  );

  const unlink = useCallback(() => save(null), [save]);

  /** A store link opened the app. */
  const handleIncoming = useCallback(
    async (identifier: string) => {
      let store: StorePreview;
      try {
        store = await storesApi.preview(identifier);
      } catch (e) {
        Alert.alert("Couldn't open that store", e instanceof ApiError ? e.message : "Please try the link again.");
        return;
      }
      const session = sessionRef.current;
      if (session.status !== "signedIn" || session.me.store.slug === store.slug) {
        await save(store);
        return;
      }
      Alert.alert(
        `Open ${store.name}?`,
        `You're signed in to ${session.me.store.name}. To shop at ${store.name}, you'll be signed out here first.`,
        [
          { text: "Stay", style: "cancel" },
          {
            text: `Go to ${store.name}`,
            onPress: () => {
              void save(store).then(() => signOut());
            },
          },
        ],
      );
    },
    [save, signOut],
  );

  // Launch: restore the saved store, refresh it (name/logo/colours may have
  // changed), and take any link that opened the app before we mounted.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await readLinkedStore();
      if (!alive) return;
      setLinked(saved);
      setReady(true);
      const incoming = takePendingStoreLink();
      if (incoming) {
        void handleIncoming(incoming);
      } else if (saved) {
        storesApi.preview(saved.slug).then(
          (fresh) => {
            if (alive) void save(fresh);
          },
          (e) => {
            // Gone for good → forget it; offline or a blip → keep what we have.
            if (alive && e instanceof ApiError && e.code === "not_found") void save(null);
          },
        );
      }
    })();
    return () => {
      alive = false;
    };
    // Launch-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Links that arrive while the app is running.
  useEffect(
    () =>
      onStoreLink((id) => {
        takePendingStoreLink();
        void handleIncoming(id);
      }),
    [handleIncoming],
  );

  const value = useMemo<StoreLinkApi>(() => ({ linked, ready, link, unlink }), [linked, ready, link, unlink]);
  return <StoreLinkContext.Provider value={value}>{children}</StoreLinkContext.Provider>;
}

export function useStoreLink(): StoreLinkApi {
  const v = useContext(StoreLinkContext);
  if (!v) throw new Error("useStoreLink must be used inside <StoreLinkProvider>");
  return v;
}
