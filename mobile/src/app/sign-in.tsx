import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { StoreChoice, StorePreview } from "@contract";
import { ApiError } from "@/api/client";
import { readLastEmail } from "@/auth/storage";
import { useSession } from "@/auth/SessionProvider";
import { APP_NAME, SUPPORT_URL } from "@/config";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { storeFromInput } from "@/store-link/parse";
import { useTheme } from "@/theme/ThemeProvider";
import { FONT, RADIUS, SPACE } from "@/theme/tokens";
import { OfflineBanner, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * One sign-in for everyone: the store's owner and staff (their website admin
 * login) and its customers (their store account). The server finds the store
 * and the app mode from the login; when one login opens several stores, the
 * person picks one here (the list only comes back
 * after a correct password).
 *
 * On a phone LINKED to a store (the seller's app link, or "Add your store"),
 * the screen wears that store's look and the login is checked against that
 * store only — so a customer always lands in the shop they came from.
 */
export default function SignIn() {
  const t = useTheme();
  const { signIn, state } = useSession();
  const { linked, unlink } = useStoreLink();
  const [addingStore, setAddingStore] = useState(false);
  const online = useOnline();
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

  const canSubmit = !!email.trim() && !!password && !busy && online;

  async function submit(store?: string) {
    if (!email.trim() || !password || busy || !online) return;
    setBusy(store ?? "form");
    setError(null);
    try {
      const picked = await signIn(email.trim(), password, store ?? linked?.slug);
      if (picked) setChoices(picked);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setChoices(null);
      setPassword("");
    } finally {
      setBusy(null);
    }
  }

  function forgotPassword() {
    if (linked) {
      Alert.alert(
        "Forgot your password?",
        `Customers: reset it on ${linked.name}'s website.\n\nStore team: ask the store owner, or contact ${APP_NAME}.`,
        [
          { text: "Close", style: "cancel" },
          { text: "Open website", onPress: () => void WebBrowser.openBrowserAsync(linked.signUpUrl) },
        ],
      );
      return;
    }
    Alert.alert(
      "Forgot your password?",
      `Shoppers: reset it on the website of the store you shop at.\n\nStore owners: contact ${APP_NAME} and we'll reset it.\n\nStaff: ask your store owner to reset your password.`,
      [
        { text: "Close", style: "cancel" },
        { text: `Contact ${APP_NAME}`, onPress: () => void WebBrowser.openBrowserAsync(SUPPORT_URL) },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
            {linked ? (
              <LinkedStoreHeader store={linked} />
            ) : (
              <View style={styles.brandRow}>
                <View style={[styles.mark, { backgroundColor: t.brand.primary }]}>
                  <AppText brandFont color={t.brand.onPrimary} style={styles.markText}>
                    {APP_NAME[0]}
                  </AppText>
                </View>
                <AppText variant="overline" color="link">
                  {APP_NAME.toUpperCase()}
                </AppText>
              </View>
            )}

            {addingStore ? (
              <AddStore onDone={() => setAddingStore(false)} />
            ) : choices ? (
              <StorePicker
                choices={choices}
                busy={busy}
                onPick={(slug) => void submit(slug)}
                onBack={() => {
                  setChoices(null);
                  setPassword("");
                }}
              />
            ) : (
              <>
                {linked ? (
                  <LinkedStoreIntro store={linked} />
                ) : (
                  <View style={{ gap: SPACE.sm }}>
                    <AppText variant="display" accessibilityRole="header">
                      {"Welcome to\n"}
                      <AppText variant="display" italic color="link">
                        {`${APP_NAME}.`}
                      </AppText>
                    </AppText>
                    <AppText variant="body" color="muted">
                      {"Shop your favorite stores, track your orders and join their community — or run your own store. Sign in with the email and password you use on the store's website."}
                    </AppText>
                  </View>
                )}

                {notice ? <Banner tone="info" icon="information-circle" text={notice} /> : null}

                <View style={{ gap: SPACE.lg }}>
                  <Field
                    label="Email"
                    value={email}
                    onChangeText={(v) => {
                      setEmail(v);
                      setError(null);
                    }}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                  <Field
                    ref={passwordRef}
                    label="Password"
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
                </View>

                {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}

                <View style={{ gap: SPACE.sm }}>
                  <Button label="Sign in" loading={busy === "form"} disabled={!canSubmit} onPress={() => void submit()} />
                  <Button label="Forgot your password?" variant="ghost" onPress={forgotPassword} />
                </View>

                {linked ? (
                  <View style={{ gap: SPACE.xs }}>
                    {linked.customerSignIn ? (
                      <Button
                        label={`Browse ${linked.name} first`}
                        variant="secondary"
                        icon="storefront-outline"
                        onPress={() => (router.canGoBack() ? router.back() : router.replace("/guest"))}
                        accessibilityHint="Look around the shop without signing in"
                      />
                    ) : null}
                    {linked.customerSignIn ? (
                      <Button
                        label="New here? Create your account"
                        variant="secondary"
                        onPress={() => void WebBrowser.openBrowserAsync(linked.signUpUrl)}
                        accessibilityHint={`Opens ${linked.name}'s website`}
                      />
                    ) : null}
                    <Button
                      label={`Not shopping at ${linked.name}? Change store`}
                      variant="ghost"
                      onPress={() => {
                        setError(null);
                        void unlink();
                      }}
                    />
                  </View>
                ) : (
                  <Button
                    label="Shopping at a store? Add it here"
                    variant="secondary"
                    onPress={() => {
                      setError(null);
                      setAddingStore(true);
                    }}
                  />
                )}

                <View style={[styles.footer, { borderTopColor: t.colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={14} color={t.colors.textFaint} />
                  <AppText variant="caption" color="faint" style={{ flex: 1 }}>
                    {linked
                      ? "Your password is never stored on this phone."
                      : "Shoppers and store teams all sign in here. Your password is never stored on this phone."}
                  </AppText>
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The linked store's name + logo, where the app mark sits otherwise. */
function LinkedStoreHeader({ store }: { store: StorePreview }) {
  return (
    <View style={styles.brandRow}>
      <StoreLogo choice={store} />
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" brandFont numberOfLines={1}>
          {store.name}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {store.address}
        </AppText>
      </View>
    </View>
  );
}

function LinkedStoreIntro({ store }: { store: StorePreview }) {
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="display" accessibilityRole="header">
        {"Welcome to\n"}
        <AppText variant="display" italic color="link">
          {`${store.name}.`}
        </AppText>
      </AppText>
      <AppText variant="body" color="muted">
        {store.customerSignIn
          ? `Sign in with the email and password of your ${store.name} account.`
          : `${store.name} hasn't opened the app to shoppers yet — for now, shop on their website. Store team, sign in below.`}
      </AppText>
    </View>
  );
}

/** "Add your store": the seller's app link or store code → the linked store. */
function AddStore({ onDone }: { onDone: () => void }) {
  const { link } = useStoreLink();
  const online = useOnline();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    const id = storeFromInput(value);
    if (!id) {
      setError("Enter the store's link or code, like hpglow or hpglow.pepweb.store.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await link(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: SPACE.xl }}>
      <View style={{ gap: SPACE.sm }}>
        <AppText variant="display" accessibilityRole="header">
          {"Add your "}
          <AppText variant="display" italic color="link">
            store.
          </AppText>
        </AppText>
        <AppText variant="body" color="muted">
          {"Paste the app link your seller shared, or type their store code. It's on the store's “Get the app” page."}
        </AppText>
      </View>
      <Field
        label="Store link or code"
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setError(null);
        }}
        placeholder="hpglow"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        autoFocus
        onSubmitEditing={() => void find()}
      />
      {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
      <View style={{ gap: SPACE.sm }}>
        <Button label="Find store" loading={busy} disabled={!value.trim() || busy || !online} onPress={() => void find()} />
        <Button label="Back" variant="ghost" onPress={onDone} disabled={busy} />
      </View>
    </View>
  );
}

function Banner({ tone, icon, text }: { tone: "info" | "danger"; icon: "information-circle" | "alert-circle"; text: string }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Ionicons name={icon} size={18} color={c.fg} />
      <AppText variant="label" color={c.fg} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

/** Same login, several stores: pick the one to manage. */
function StorePicker({
  choices,
  busy,
  onPick,
  onBack,
}: {
  choices: StoreChoice[];
  busy: string | null;
  onPick: (slug: string) => void;
  onBack: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.xl }}>
      <View style={{ gap: SPACE.sm }}>
        <AppText variant="display" accessibilityRole="header">
          {"Which "}
          <AppText variant="display" italic color="link">
            store?
          </AppText>
        </AppText>
        <AppText variant="body" color="muted">
          {`This login opens ${choices.length} stores. You can switch any time by signing out.`}
        </AppText>
      </View>
      <View style={{ gap: SPACE.sm }}>
        {choices.map((c) => (
          <Pressable
            key={c.slug}
            accessibilityRole="button"
            accessibilityLabel={`Open ${c.name}`}
            accessibilityState={{ busy: busy === c.slug, disabled: !!busy }}
            disabled={!!busy}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onPick(c.slug);
            }}
            style={({ pressed }) => [
              styles.store,
              {
                backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                borderColor: busy === c.slug ? t.brand.link : t.colors.border,
                opacity: busy && busy !== c.slug ? 0.5 : 1,
              },
            ]}
          >
            <StoreLogo choice={c} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {c.name}
              </AppText>
              <AppText variant="caption" color="muted" numberOfLines={1}>
                {c.address}
              </AppText>
            </View>
            <Ionicons name={busy === c.slug ? "hourglass-outline" : "chevron-forward"} size={18} color={t.colors.textFaint} />
          </Pressable>
        ))}
      </View>
      <Button label="Use a different account" variant="ghost" onPress={onBack} disabled={!!busy} />
    </View>
  );
}

function StoreLogo({ choice }: { choice: Pick<StoreChoice, "name" | "logoUrl"> }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  if (choice.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: choice.logoUrl }}
        contentFit="contain"
        onError={() => setFailed(true)}
        style={[styles.logo, { backgroundColor: t.colors.surfaceAlt }]}
      />
    );
  }
  return (
    <View style={[styles.logo, { backgroundColor: t.tone("success").bg }]}>
      <AppText brandFont color={t.tone("success").fg} style={{ fontSize: 22, lineHeight: 26 }}>
        {choice.name.trim()[0]?.toUpperCase() ?? "·"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: SPACE.xl, paddingTop: SPACE.xxl, gap: SPACE.xl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  mark: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  markText: { fontFamily: FONT.serif, fontSize: 26, lineHeight: 30 },
  banner: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.md },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    marginTop: "auto",
    paddingTop: SPACE.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  store: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    minHeight: 64,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  logo: { width: 44, height: 44, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
});
