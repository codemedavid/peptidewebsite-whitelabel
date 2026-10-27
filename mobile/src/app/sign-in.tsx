import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import type { StoreChoice } from "@contract";
import { ApiError } from "@/api/client";
import { readLastEmail } from "@/auth/storage";
import { useSession } from "@/auth/SessionProvider";
import { APP_NAME, GUEST_BROWSING, SUPPORT_URL } from "@/config";
import { AuthField } from "@/features/session/sign-in/AuthField";
import { BackButton, Banner, PrimaryCta, StoreLogo, TextLink, useAuthAccent } from "@/features/session/sign-in/parts";
import { SheetHeading, StorePicker } from "@/features/session/sign-in/StoreSteps";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * One sign-in for everyone — owners, staff and customers: email + password.
 * The server finds the store from the login itself; only when one login opens
 * several stores does a picker show (and if the phone is linked to one of
 * them, that one is opened without asking).
 *
 * The login is never scoped to the linked store: a phone linked to the wrong
 * store used to reject a correct password with "Incorrect email or password".
 * The link now only picks the look and the default store.
 */
const APP_LOGO = require("../../assets/brand/pepworld-logo.png");
/** The logo art is 915×759 — keep that ratio so it never stretches. */
const LOGO_WIDTH = 132;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 759) / 915);
const STORE_LOGO_SIZE = 72;

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, state } = useSession();
  const { linked, unlink } = useStoreLink();
  const accent = useAuthAccent(!!linked);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<StoreChoice[] | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const notice = state.status === "signedOut" ? state.notice : undefined;

  useEffect(() => {
    void readLastEmail().then((last) => {
      if (!last) return;
      setEmail((e) => e || last);
      passwordRef.current?.focus();
    });
  }, []);

  const canSubmit = !!email.trim() && !!password && !busy;
  // Shoppers make their account here; a linked store must run the app community.
  const canCreateAccount = !linked || linked.customerSignIn;

  async function submit(store?: string) {
    if (!email.trim() || !password || busy) return;
    setBusy(store ?? "form");
    setError(null);
    try {
      const picked = await signIn(email.trim(), password, store);
      if (!picked) return;
      // Several stores: the linked one wins without asking.
      const preferred = linked && picked.find((c) => c.slug === linked.slug);
      if (preferred) {
        setBusy(null);
        await submit(preferred.slug);
        return;
      }
      setChoices(picked);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setChoices(null);
    } finally {
      setBusy(null);
    }
  }

  function forgotPassword() {
    Alert.alert(
      "Forgot your password?",
      linked
        ? `Customers: message ${linked.name} and ask them to reset it. They'll send you a temporary password.\n\nStore team: ask the store owner, or contact ${APP_NAME}.`
        : `Shoppers: message the store you shop at and ask them to reset it. They'll send you a temporary password.\n\nStore owners: contact ${APP_NAME} and we'll reset it.\n\nStaff: ask your store owner to reset your password.`,
      [
        { text: "Close", style: "cancel" },
        linked
          ? { text: "Message the store", onPress: () => void WebBrowser.openBrowserAsync(linked.websiteUrl) }
          : { text: `Contact ${APP_NAME}`, onPress: () => void WebBrowser.openBrowserAsync(SUPPORT_URL) },
      ],
    );
  }

  const backToWelcome = () => (router.canGoBack() ? router.back() : router.replace("/welcome"));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + SPACE.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={SPACE.xl}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={backToWelcome} />
        <View style={styles.brand}>
          {linked ? (
            <>
              <StoreLogo choice={linked} size={STORE_LOGO_SIZE} />
              <AppText variant="heading" brandFont numberOfLines={1}>
                {linked.name}
              </AppText>
            </>
          ) : (
            <Image source={APP_LOGO} style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} contentFit="contain" />
          )}
        </View>

        {choices ? (
          <StorePicker
            choices={choices}
            busy={busy}
            accent={accent}
            onPick={(slug) => void submit(slug)}
            onBack={() => {
              setChoices(null);
              setPassword("");
            }}
          />
        ) : (
          <>
            <SheetHeading
              lead="Sign "
              emphasis="in."
              body="Shoppers and store teams both sign in here with their email and password."
              accent={accent}
            />

            {notice ? <Banner tone="info" icon="information-circle" text={notice} /> : null}

            <View style={{ gap: SPACE.md }}>
              <AuthField
                label="Email address"
                icon="mail-outline"
                focusColor={accent.link}
                invalid={!!error}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <AuthField
                ref={passwordRef}
                label="Password"
                icon="lock-closed-outline"
                focusColor={accent.link}
                invalid={!!error}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setError(null);
                }}
                password
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              <TextLink label="Forgot password?" color={accent.link} onPress={forgotPassword} style={styles.end} />
              {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
            </View>

            <PrimaryCta
              label="Sign in"
              accent={accent}
              loading={!!busy}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />

            {canCreateAccount ? (
              <TextLink
                label="New here? Create an account"
                color={accent.link}
                onPress={() => router.push("/create-account")}
                style={styles.center}
              />
            ) : null}

            {linked ? (
              <View style={styles.links}>
                {GUEST_BROWSING && linked.customerSignIn ? (
                  <TextLink
                    label={`Browse ${linked.name} first`}
                    color={accent.link}
                    onPress={() => (router.canGoBack() ? router.back() : router.replace("/guest"))}
                  />
                ) : null}
                <TextLink
                  label="Not your store? Change store"
                  color={t.colors.textMuted}
                  onPress={() => {
                    setError(null);
                    void unlink();
                  }}
                />
              </View>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: SPACE.xl, gap: SPACE.xl },
  brand: { alignItems: "center", gap: SPACE.sm },
  end: { alignSelf: "flex-end" },
  center: { alignSelf: "center" },
  links: { alignItems: "center", gap: SPACE.md },
});
