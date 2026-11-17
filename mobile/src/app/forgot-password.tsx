import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { StoreContactChannel, StorePreview } from "@contract";
import { ApiError } from "@/api/client";
import { storesApi } from "@/api/endpoints";
import { APP_NAME, SUPPORT_URL } from "@/config";
import { CONTACT_CHANNELS, channelLink, channelMeta, channelPrefills } from "@/features/contact/channels";
import { AuthField } from "@/features/session/sign-in/AuthField";
import { BackButton, Banner, PrimaryCta, StoreLogo, TextLink, useAuthAccent, type AuthAccent } from "@/features/session/sign-in/parts";
import { SheetHeading } from "@/features/session/sign-in/StoreSteps";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

const STEPS = [
  { icon: "chatbubble-ellipses-outline", text: "Message the store below. Your email is already in the message." },
  { icon: "key-outline", text: "They send you a new, temporary password." },
  { icon: "shield-checkmark-outline", text: "Sign in with it, then pick your own in Me → Change password." },
] as const;

function resetMessage(storeName: string, email: string): string {
  const who = email.trim() ? `My account email is ${email.trim()}.` : "";
  return `Hi ${storeName}! I forgot my password for the ${APP_NAME} app. ${who} Could you send me a new one? Thank you!`.replace(/\s+/g, " ");
}

/** One big tappable "Message on WhatsApp" row. */
function ChannelButton({ channel, onPress }: { channel: StoreContactChannel; onPress: () => void }) {
  const t = useTheme();
  const meta = channelMeta(channel.type);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Message on ${meta.label}`}
      accessibilityHint={channelPrefills(channel.type) ? "Opens the chat with your message written" : "Copies your message, then opens the chat"}
      style={({ pressed }) => [
        styles.channel,
        { backgroundColor: t.colors.surface, borderColor: pressed ? meta.color : t.colors.border, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      <View style={[styles.channelIcon, { backgroundColor: meta.color }]}>
        <Ionicons name={meta.icon} size={22} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{`Message on ${meta.label}`}</AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {channelPrefills(channel.type) ? "Your message is ready to send" : "We'll copy your message to paste"}
        </AppText>
      </View>
      <Ionicons name="open-outline" size={18} color={t.colors.textFaint} />
    </Pressable>
  );
}

/** Not linked to a store: ask which one, without linking the phone to it. */
function FindStore({ accent, onFound }: { accent: AuthAccent; onFound: (store: StorePreview) => void }) {
  const [code, setCode] = useState("");
  const find = useMutation({ mutationFn: () => storesApi.preview(code.trim()), onSuccess: onFound });
  return (
    <View style={{ gap: SPACE.md }}>
      <AppText variant="bodyStrong">Which store do you shop at?</AppText>
      <AuthField
        label="Store code or link"
        icon="storefront-outline"
        focusColor={accent.link}
        invalid={find.isError}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          find.reset();
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => code.trim() && find.mutate()}
      />
      {find.isError ? (
        <Banner tone="danger" icon="alert-circle" text={find.error instanceof ApiError ? find.error.message : "We couldn't find that store."} />
      ) : null}
      <PrimaryCta label="Find my store" icon="search" accent={accent} loading={find.isPending} disabled={!code.trim()} onPress={() => find.mutate()} />
    </View>
  );
}

/**
 * "Forgot password?" — there's no email reset: the store sets a new password
 * by hand (Community → Members → Reset password). This screen gets the member
 * there in one tap: their email pre-written into a message to the store, on
 * whichever apps the store owner turned on in Contact Methods.
 */
export default function ForgotPassword() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const { linked } = useStoreLink();
  const accent = useAuthAccent(!!linked);
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [picked, setPicked] = useState<StorePreview | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Fresh from the server: the owner may have changed their contact methods since the phone linked.
  const fresh = useQuery({
    queryKey: ["store-preview", linked?.slug ?? ""],
    queryFn: () => storesApi.preview(linked!.slug),
    enabled: !!linked,
    staleTime: 60_000,
  });
  const store = picked ?? fresh.data ?? linked;
  const channels = (store?.contactChannels ?? []).filter((c) => CONTACT_CHANNELS.some((m) => m.type === c.type));
  const message = store ? resetMessage(store.name, email) : "";

  async function open(channel: StoreContactChannel) {
    if (!store) return;
    void Haptics.selectionAsync().catch(() => undefined);
    if (!channelPrefills(channel.type)) {
      await Clipboard.setStringAsync(message);
      setCopied(channelMeta(channel.type).label);
    }
    const url = channelLink(channel.type, channel.destination, message, `${APP_NAME} password reset`);
    try {
      await Linking.openURL(url);
    } catch {
      if (url.startsWith("http")) await WebBrowser.openBrowserAsync(url).catch(() => undefined);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.page, { paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + SPACE.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={SPACE.xl}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={back} />
        {store ? (
          <View style={styles.brand}>
            <StoreLogo choice={store} size={56} />
            <AppText variant="bodyStrong" brandFont numberOfLines={1}>
              {store.name}
            </AppText>
          </View>
        ) : null}

        <SheetHeading
          lead="Forgot your "
          emphasis="password?"
          body={
            store
              ? `${store.name} resets passwords personally. Send them a quick message and they'll get you back in.`
              : "Your store resets passwords personally. Find your store and message them and they'll get you back in."
          }
          accent={accent}
        />

        {!store ? (
          <FindStore accent={accent} onFound={setPicked} />
        ) : (
          <>
            <AuthField
              label="Your account email"
              icon="mail-outline"
              focusColor={accent.link}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
            />

            <View style={[styles.steps, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <AppText variant="overline" color="muted">
                How it works
              </AppText>
              {STEPS.map((s, i) => (
                <View key={s.icon} style={styles.step}>
                  <View style={[styles.stepDot, { backgroundColor: accent.fill }]}>
                    <AppText variant="caption" style={{ color: accent.onFill, fontWeight: "700" }}>
                      {String(i + 1)}
                    </AppText>
                  </View>
                  <AppText variant="body" style={{ flex: 1 }}>
                    {s.text}
                  </AppText>
                </View>
              ))}
            </View>

            {fresh.isPending && !!linked && !linked.contactChannels ? (
              <ActivityIndicator color={accent.link} accessibilityLabel="Loading the store's contact options" />
            ) : channels.length ? (
              <View style={{ gap: SPACE.sm }}>
                {channels.map((c) => (
                  <ChannelButton key={c.type} channel={c} onPress={() => void open(c)} />
                ))}
                {copied ? (
                  <Banner tone="info" icon="clipboard-outline" text={`Message copied. Paste it in ${copied} and send.`} />
                ) : null}
              </View>
            ) : (
              <View style={{ gap: SPACE.md }}>
                <Banner tone="info" icon="information-circle" text={`${store.name} hasn't added a way to message them in the app yet. Reach them through their website.`} />
                <PrimaryCta label="Open their website" icon="globe-outline" accent={accent} onPress={() => void WebBrowser.openBrowserAsync(store.websiteUrl)} />
              </View>
            )}
          </>
        )}

        <View style={styles.links}>
          <TextLink label="Back to sign in" color={accent.link} onPress={back} />
          <TextLink label={`Store owner or staff? Contact ${APP_NAME}`} color={t.colors.textMuted} onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_URL)} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: SPACE.xl, gap: SPACE.xl },
  brand: { alignItems: "center", gap: SPACE.sm },
  links: { alignItems: "center", gap: SPACE.md, marginTop: "auto" },
  steps: { gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  step: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    minHeight: 64,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
  },
  channelIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
