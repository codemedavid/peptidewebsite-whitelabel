import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import type { StorePreview } from "@contract";
import { ApiError } from "@/api/client";
import { storesApi } from "@/api/endpoints";
import { findStoreNext, lookupFailureMessage, readStoreCode } from "@/features/session/find-store/rules";
import { StoreConfirm } from "@/features/session/find-store/StoreConfirm";
import { AuthField } from "@/features/session/sign-in/AuthField";
import { BackButton, Banner, PrimaryCta, TextLink, useAuthAccent } from "@/features/session/sign-in/parts";
import { SheetHeading } from "@/features/session/sign-in/StoreSteps";
import { useSession } from "@/auth/SessionProvider";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * The store code step. An app installed straight from the App Store doesn't
 * know which seller the shopper buys from (the seller's link is lost on the
 * way through the store), so the shopper types the code from the seller's
 * /app page — or pastes the link — and confirms the store before signing up.
 *
 * Looking a store up never links it: only "Create an account" / "Sign in" on
 * the confirm card does, so a wrong code never rebrands the app.
 */
export default function FindStore() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ next?: string }>();
  const next = findStoreNext(params.next);
  const { choose } = useStoreLink();
  const { startGuest } = useSession();
  const accent = useAuthAccent(false);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<StorePreview | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLookup() {
    if (isLooking) return;
    const read = readStoreCode(code);
    if (!read.ok) {
      setError(read.message);
      return;
    }
    setIsLooking(true);
    setError(null);
    try {
      setFound(await storesApi.preview(read.id));
    } catch (e) {
      setError(
        e instanceof ApiError ? lookupFailureMessage(e.code, e.message) : lookupFailureMessage(undefined, undefined),
      );
    } finally {
      setIsLooking(false);
    }
  }

  /** Link the confirmed store, then swap this step for the screen it opens. */
  async function handleContinue(to: "/create-account" | "/sign-in") {
    if (!found || isLinking) return;
    setIsLinking(true);
    try {
      await choose(found);
      router.replace(to);
    } finally {
      setIsLinking(false);
    }
  }

  /** Shop as a guest: link the store, then open a guest session (the app swaps to the shop). */
  async function handleGuest() {
    if (!found || isLinking) return;
    setIsLinking(true);
    setError(null);
    try {
      await choose(found);
      await startGuest(found.slug);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't open the shop. Please try again.");
      setIsLinking(false);
    }
  }

  function handleRetry() {
    setFound(null);
    setError(null);
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/welcome"));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: insets.top + SPACE.sm,
            paddingBottom: insets.bottom + SPACE.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={SPACE.xl}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={found ? handleRetry : goBack} />

        {found ? (
          <>
          {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
          <StoreConfirm
            store={found}
            accent={accent}
            next={next}
            busy={isLinking}
            onCreateAccount={() => void handleContinue("/create-account")}
            onSignIn={() => void handleContinue("/sign-in")}
            onGuest={() => void handleGuest()}
            onOpenWebsite={() => void WebBrowser.openBrowserAsync(found.websiteUrl)}
            onRetry={handleRetry}
          />
          </>
        ) : (
          <>
            <SheetHeading
              lead="Find your "
              emphasis="store."
              body="Enter the store code your seller gave you, or paste their app link."
              accent={accent}
            />

            <View style={{ gap: SPACE.md }}>
              <AuthField
                label="Store code or link"
                icon="storefront-outline"
                focusColor={accent.link}
                invalid={!!error}
                value={code}
                onChangeText={(v) => {
                  setCode(v);
                  setError(null);
                }}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="search"
                onSubmitEditing={() => void handleLookup()}
              />
              {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
            </View>

            <PrimaryCta
              label="Find my store"
              icon="search"
              accent={accent}
              loading={isLooking}
              disabled={!code.trim()}
              onPress={() => void handleLookup()}
            />

            <View style={[styles.help, { backgroundColor: t.colors.surfaceAlt }]}>
              <AppText variant="bodyStrong">Where do I find it?</AppText>
              <AppText variant="label" color="muted">
                It&apos;s on your seller&apos;s app page, usually their shop name (for example vrjonina). Or just tap the app link
                your seller shared, and the app opens their store for you.
              </AppText>
            </View>

            <TextLink
              label="Already have an account? Sign in"
              color={accent.link}
              onPress={() => router.replace("/sign-in")}
              style={styles.center}
            />
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: SPACE.xl, gap: SPACE.xl },
  help: { gap: SPACE.xs, padding: SPACE.lg, borderRadius: 20 },
  center: { alignSelf: "center" },
});
