import { useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSignedIn } from "@/auth/SessionProvider";
import { useCommunityAccess } from "./hooks/useInbox";
import { parseStoredView, startView, viewKey, type AppView } from "./lib/viewMode";

const HOME: Record<AppView, "/" | "/community-view"> = { business: "/", community: "/community-view" };

/** Switch a store admin between the business app and the community view (remembered per store). */
export function useSwitchView() {
  const { scope } = useSignedIn();
  return useCallback(
    (view: AppView) => {
      void AsyncStorage.setItem(viewKey(scope), view).catch(() => undefined);
      void Haptics.selectionAsync().catch(() => undefined);
      router.replace(HOME[view]);
    },
    [scope],
  );
}

/** After each sign-in: reopen the community view if that's where the admin left off. */
export function useRestoreView() {
  const { scope } = useSignedIn();
  const access = useCommunityAccess();
  const allowed = access.adminChatsTab;
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void AsyncStorage.getItem(viewKey(scope))
      .then((raw) => {
        if (live && startView(parseStoredView(raw), access) === "community") router.replace(HOME.community);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per sign-in (and when moderation access appears).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, allowed]);
}
