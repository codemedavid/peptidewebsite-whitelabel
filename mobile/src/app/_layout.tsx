import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from "@expo-google-fonts/instrument-sans";
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { focusManager, onlineManager, QueryClient, type Query } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ApiError } from "@/api/client";
import { GUEST_BROWSING } from "@/config";
import { SessionProvider, useSession } from "@/auth/SessionProvider";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";
import { UnreachableScreen } from "@/features/session/UnreachableScreen";
import { ShopProvider } from "@/features/shop/ShopProvider";
import { StoreLinkProvider, useStoreLink } from "@/store-link/StoreLinkProvider";

void SplashScreen.preventAutoHideAsync();

// React Query follows the app's foreground state and the network: polls
// (inbox, open threads, live orders) pause in the background and offline.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)),
);
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener("change", (s) => setFocused(s === "active"));
  return () => sub.remove();
});

const NO_RETRY = new Set(["unauthenticated", "session_revoked", "forbidden", "not_found", "store_unavailable", "invalid_input", "conflict"]);

/**
 * Screens open from the last copy saved on the phone, then refresh in the
 * background — a cold start never waits on the network to show data it has
 * already seen. The saved copy is dropped after a day, on an app update
 * (buster), and on sign-out/sign-in (SessionProvider clears the client, which
 * persists the empty cache).
 */
const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;
const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "pepweb.query-cache.v1" });

/** Live checkout quotes are never saved: a stale total must not flash on launch. */
function shouldPersist(query: Query): boolean {
  return query.state.status === "success" && !query.queryKey.includes("quote");
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Kept at least as long as the saved copy, or it's gone before it's used.
        gcTime: PERSIST_MAX_AGE,
        refetchIntervalInBackground: false,
        retry: (count, e) => !(e instanceof ApiError && NO_RETRY.has(e.code)) && count < 2,
      },
      // Never auto-retry a write: a status change must not be sent twice.
      mutations: { retry: false },
    },
  });
}

export default function RootLayout() {
  const [client] = useState(makeClient);
  return (
    <SafeAreaProvider>
      {/* Keyboard-aware layouts (chat composer) that work under Android edge-to-edge. */}
      <KeyboardProvider>
        <PersistQueryClientProvider
          client={client}
          persistOptions={{
            persister,
            maxAge: PERSIST_MAX_AGE,
            buster: Constants.expoConfig?.version ?? "",
            dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
          }}
        >
          <SessionProvider>
            <StoreLinkProvider>
              <ThemedRoot />
            </StoreLinkProvider>
          </SessionProvider>
        </PersistQueryClientProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const { state } = useSession();
  const { linked } = useStoreLink();
  // Signed in → the session's store. Signed out on a linked phone → the
  // linked store's look, so a customer's sign-in already feels like the shop.
  const brand = state.status === "signedIn" ? state.me.theme : linked?.theme ?? null;
  return (
    <ThemeProvider brand={brand}>
      <Navigator />
    </ThemeProvider>
  );
}

function Navigator() {
  const { state } = useSession();
  const storeLink = useStoreLink();
  const t = useTheme();
  // Bundled with the app (pepweb.store's typefaces) — a failure falls back to
  // the system font rather than holding the splash forever.
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    // The community chat surfaces use Inter (features/community/theme.ts).
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = state.status !== "loading" && storeLink.ready && (fontsLoaded || !!fontError);

  // The splash stays up until we know WHICH store to show and the type is in.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: t.colors.bg }} />;
  if (state.status === "unreachable") return <UnreachableScreen />;

  const signedIn = state.status === "signedIn";
  // Signed out, the app is the welcome screen and its two doors (sign in,
  // create account) — nothing else. The guest shop stays off unless
  // GUEST_BROWSING is turned back on.
  const guestShop = GUEST_BROWSING && !signedIn && !!storeLink.linked?.customerSignIn;
  return (
    <ShopProvider>
      <StatusBar style={t.statusBar} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={guestShop}>
          <Stack.Screen name="guest" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          {/* First = where a signed-out app lands (cold start, sign-out, "/"). */}
          <Stack.Screen name="welcome" options={{ animation: "fade" }} />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="create-account" />
        </Stack.Protected>
      </Stack>
    </ShopProvider>
  );
}
