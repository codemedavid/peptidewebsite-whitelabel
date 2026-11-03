import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { liveApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";

/**
 * The live snapshot, refreshed every `intervalMs` — but only while the screen
 * using it is focused and the app is in front, so a backgrounded phone never
 * polls. Home and the Live screen share one cache entry.
 */
export function useLive(intervalMs: number) {
  const { me, scope } = useSignedIn();
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  return useQuery({
    queryKey: qk.live(scope),
    queryFn: liveApi.get,
    enabled: me.can.analytics,
    refetchInterval: focused && appActive ? intervalMs : false,
    placeholderData: (prev) => prev,
  });
}
