import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GroupBuyJoinState, ShopGroupBuyTeaser, ShopPaymentMethod } from "@shop-contract";
import type { Tone } from "@contract";
import { ApiError, type UploadFile } from "@/api/client";
import { askPhotoSource, PhotoError, pickPhotos } from "@/features/admin/catalog/images";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { SkeletonList } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { shopApi } from "../../api";
import { useGroupBuyJoin, useGroupBuyJoinActions } from "../../hooks";
import { money } from "../../lib/money";
import { useShop } from "../../ShopProvider";
import { FormSection, Notice } from "../ShopUI";
import { groupBuyBand, LiveDot, RoundClock } from "./GroupBuyParts";

/**
 * Paid group-buy JOIN (lib/storefront/gb-join.server.ts) — what a shopper sees
 * instead of the round until the store approves them: join → pay the fee →
 * send the receipt + reference → wait. The server has already left the round's
 * products and prices out of the catalog; everything here is the teaser plus
 * the shopper's own request. Approval is picked up by the catalog refetch, at
 * which point GroupBuyScreen shows the real round.
 */

const STEPS = ["Join", "Pay & send receipt", "Approval"] as const;
const TONE: Record<GroupBuyJoinState["status"]["tone"], Tone> = { neutral: "neutral", pending: "warning", success: "success", danger: "danger" };
const HERO_RADIUS = 20;

function stepFor(status: string | undefined): number {
  if (status === "pending_payment") return 1;
  if (status === "paid_pending_approval") return 2;
  if (status === "approved") return 3;
  return 0;
}

/** "₱500" / "₱499.50" — the same shape as the server's joinFeeLabel, so the
 *  banner and the join screen never disagree about the fee. */
function feeLabel(teaser: ShopGroupBuyTeaser, currency: string): string {
  const label = money(teaser.joinFeeCents / 100, currency);
  return teaser.joinFeeCents % 100 === 0 ? label.replace(/\.00$/, "") : label;
}

export function GroupBuyJoinScreen({ teaser, currency, onRefreshCatalog }: { teaser: ShopGroupBuyTeaser; currency: string; onRefreshCatalog: () => void }) {
  const t = useTheme();
  const shop = useShop();
  const q = useGroupBuyJoin(teaser.id);
  const state = q.data;
  const step = stepFor(state?.request?.status ?? teaser.membership?.status);
  const refresh = () => {
    void q.refetch();
    onRefreshCatalog();
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} />}
    >
      <JoinHero teaser={teaser} fee={state?.joinFeeLabel ?? feeLabel(teaser, currency)} />
      <Steps current={step} />

      {shop.mode !== "customer" ? (
        <FormSection title="Sign in to join" hint="Your join request and approval are tied to your account.">
          <Button label="Sign in" icon="log-in-outline" onPress={() => router.push("/sign-in")} />
        </FormSection>
      ) : q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError || !state ? (
        <Notice tone="danger" icon="alert-circle-outline" action={<Button label="Try again" variant="secondary" onPress={() => void q.refetch()} />}>
          {q.error instanceof Error ? q.error.message : "We couldn't load this group buy."}
        </Notice>
      ) : (
        <JoinBody state={state} roundId={teaser.id} onApproved={onRefreshCatalog} />
      )}
    </ScrollView>
  );
}

function JoinHero({ teaser, fee }: { teaser: ShopGroupBuyTeaser; fee: string }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  const live = teaser.state === "live";
  return (
    <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={[styles.glow, { backgroundColor: band.glow }]} pointerEvents="none" />
      <View style={styles.eyebrow}>
        <LiveDot live={live} />
        <AppText variant="overline" color={band.text}>
          Members-only group buy
        </AppText>
      </View>
      <AppText variant="title" brandFont color={band.text} numberOfLines={2}>
        {teaser.name}
      </AppText>
      <AppText variant="body" color={band.muted}>
        Pay the join fee and send your receipt. Once the store approves you, the products and prices open up.
      </AppText>
      {live && teaser.endsAt ? <RoundClock endsAt={teaser.endsAt} color={band.text} boxColor={band.chip} /> : null}
      <View style={[styles.feeRow, { borderTopColor: band.line }]}>
        <AppText variant="stat" color={band.text}>
          {fee}
        </AppText>
        <AppText variant="caption" color={band.muted}>
          one-time join fee
        </AppText>
      </View>
    </LinearGradient>
  );
}

function Steps({ current }: { current: number }) {
  const t = useTheme();
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${Math.min(current + 1, 3)} of 3`}>
      {STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current && current < 3;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.dot,
                { borderColor: done || now ? t.brand.primary : t.colors.border, backgroundColor: done ? t.brand.primary : t.colors.surface },
              ]}
            >
              {done ? (
                <Ionicons name="checkmark" size={14} color={t.brand.onPrimary} />
              ) : (
                <AppText variant="caption" color={now ? "link" : "muted"}>
                  {String(i + 1)}
                </AppText>
              )}
            </View>
            <AppText variant="caption" color={now ? "text" : "muted"} style={{ textAlign: "center" }}>
              {label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function statusIcon(status: string | undefined) {
  if (status === "approved") return "checkmark-circle-outline" as const;
  if (status === "rejected" || status === "revoked") return "close-circle-outline" as const;
  return "time-outline" as const;
}

function JoinBody({ state, roundId, onApproved }: { state: GroupBuyJoinState; roundId: string; onApproved: () => void }) {
  const { join } = useGroupBuyJoinActions(roundId);
  const status = state.request?.status;
  return (
    <View style={{ gap: SPACE.md }}>
      {state.request ? (
        <Notice tone={TONE[state.status.tone]} icon={statusIcon(status)}>
          <AppText variant="bodyStrong">{state.status.title}</AppText>
          <AppText variant="caption" color="muted">
            {state.status.detail}
          </AppText>
        </Notice>
      ) : null}

      {join.error ? (
        <Notice tone="danger" icon="alert-circle-outline">
          {join.error instanceof Error ? join.error.message : "Couldn't start your request."}
        </Notice>
      ) : null}

      {state.canJoin ? (
        <FormSection title={status === "refunded" ? "Join again" : "Ready to join?"} hint={`You'll see where to send ${state.joinFeeLabel} next. You pay the store directly.`}>
          <Button label={`Join for ${state.joinFeeLabel}`} icon="people-outline" loading={join.isPending} onPress={() => join.mutate()} />
        </FormSection>
      ) : null}

      {status === "pending_payment" ? (
        <>
          <PayTo methods={state.paymentMethods} amount={state.joinFeeLabel} />
          <ReceiptForm roundId={roundId} methods={state.paymentMethods} />
        </>
      ) : null}

      {status === "paid_pending_approval" && state.request ? <Sent roundId={roundId} request={state.request} amount={state.joinFeeLabel} /> : null}

      {status === "approved" ? <Button label="Open the group buy" icon="arrow-forward" onPress={onApproved} /> : null}
    </View>
  );
}

function PayTo({ methods, amount }: { methods: ShopPaymentMethod[]; amount: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState("");
  const copy = async (m: ShopPaymentMethod) => {
    await Clipboard.setStringAsync(m.number).catch(() => undefined);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setCopied(m.id);
    setTimeout(() => setCopied((c) => (c === m.id ? "" : c)), 1600);
  };
  return (
    <FormSection title={`Send exactly ${amount} to`}>
      {methods.length === 0 ? (
        <AppText variant="body" color="muted">
          The store hasn&apos;t listed a payment account yet — message them for where to pay.
        </AppText>
      ) : (
        methods.map((m) => (
          <View key={m.id} style={[styles.method, { backgroundColor: t.colors.bg, borderColor: t.colors.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">{m.name}</AppText>
              {m.account ? (
                <AppText variant="caption" color="muted">
                  {m.account}
                </AppText>
              ) : null}
              {m.number ? (
                <View style={styles.numberRow}>
                  <AppText variant="bodyStrong" style={styles.number} selectable>
                    {m.number}
                  </AppText>
                  <Pressable
                    onPress={() => void copy(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${m.name} number`}
                    hitSlop={10}
                    style={({ pressed }) => [styles.copy, { borderColor: t.brand.link, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <AppText variant="caption" color="link">
                      {copied === m.id ? "Copied" : "Copy"}
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
            {m.qrImage ? <Image source={{ uri: m.qrImage }} style={styles.qr} contentFit="cover" accessibilityLabel={`${m.name} QR code`} /> : null}
          </View>
        ))
      )}
    </FormSection>
  );
}

function ReceiptForm({ roundId, methods }: { roundId: string; methods: ShopPaymentMethod[] }) {
  const t = useTheme();
  const { sendReceipt } = useGroupBuyJoinActions(roundId);
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState(methods[0]?.name ?? "");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function choose() {
    const source = await askPhotoSource("Payment receipt");
    if (!source) return;
    try {
      const picked = (await pickPhotos(source))?.[0];
      if (picked) setPhoto(picked);
    } catch (e) {
      Alert.alert("Couldn't use that photo", e instanceof PhotoError ? e.message : "Please try another photo.");
    }
  }

  function submit() {
    if (!photo) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    sendReceipt.mutate(
      { file: photo, reference: reference.trim(), method, signal: controller.signal },
      { onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined) },
    );
  }

  const aborted = sendReceipt.error instanceof ApiError && sendReceipt.error.code === "aborted";
  const error = sendReceipt.error && !aborted ? sendReceipt.error : null;
  return (
    <FormSection title="Send your receipt" hint="A screenshot from GCash or your bank app is perfect.">
      <Pressable
        onPress={() => void choose()}
        accessibilityRole="button"
        accessibilityLabel={photo ? "Change receipt photo" : "Add receipt photo"}
        style={({ pressed }) => [styles.drop, { borderColor: photo ? t.colors.border : t.brand.link, backgroundColor: t.colors.bg, opacity: pressed ? 0.85 : 1 }]}
      >
        {photo ? (
          <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="contain" accessibilityLabel="Your receipt" />
        ) : (
          <>
            <Ionicons name="receipt-outline" size={26} color={t.brand.link} />
            <AppText variant="label" color="link">
              Add a screenshot of your payment
            </AppText>
          </>
        )}
      </Pressable>
      <Field
        label="Reference number"
        value={reference}
        onChangeText={setReference}
        placeholder="e.g. 1023 4567 8901"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
      />
      {methods.length > 1 ? (
        <View style={{ gap: SPACE.xs }}>
          <AppText variant="label" color="muted">
            Paid with
          </AppText>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {methods.map((m) => {
              const on = m.name === method;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setMethod(m.name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: on ? t.brand.primary : t.colors.border, backgroundColor: on ? t.brand.primary : t.colors.surface, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <AppText variant="label" color={on ? "onPrimary" : "text"}>
                    {m.name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {error ? (
        <Notice tone="danger" icon="alert-circle-outline">
          {error instanceof Error ? error.message : "Couldn't send your receipt."}
        </Notice>
      ) : null}
      <Button label="Send receipt" icon="send-outline" loading={sendReceipt.isPending} disabled={!photo || reference.trim().length < 4} onPress={submit} />
    </FormSection>
  );
}

function Sent({ roundId, request, amount }: { roundId: string; request: NonNullable<GroupBuyJoinState["request"]>; amount: string }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      const { url } = await shopApi.groupBuyReceiptUrl(roundId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Couldn't open your receipt", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setOpening(false);
    }
  };
  const rows: [string, string][] = [["Amount", amount], ["Reference", request.reference]];
  if (request.method) rows.push(["Paid with", request.method]);
  if (request.submittedAt) rows.push(["Sent", new Date(request.submittedAt).toLocaleString()]);
  return (
    <FormSection title="Your payment">
      {rows.map(([k, v]) => (
        <View key={k} style={styles.fact}>
          <AppText variant="body" color="muted">
            {k}
          </AppText>
          <AppText variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }}>
            {v}
          </AppText>
        </View>
      ))}
      {request.hasReceipt ? <Button label="View my receipt" variant="ghost" icon="image-outline" loading={opening} onPress={() => void open()} /> : null}
    </FormSection>
  );
}

/** The shop front's invitation into a paid round the shopper isn't in yet. */
export function GroupBuyJoinBanner({ teaser, currency, onPress }: { teaser: ShopGroupBuyTeaser; currency: string; onPress: () => void }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  if (teaser.state === "closed") return null;
  const requested = !!teaser.membership && teaser.membership.status !== "refunded";
  const cta = requested ? "Check your request" : `Join for ${feeLabel(teaser, currency)}`;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Members-only group buy ${teaser.name}. ${cta}`}
      style={({ pressed }) => [styles.bannerShadow, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.eyebrow}>
          <LiveDot live={teaser.state === "live"} />
          <AppText variant="overline" color={band.text}>
            {teaser.state === "live" ? "Live · members only" : "Coming soon · members only"}
          </AppText>
        </View>
        <AppText variant="heading" brandFont color={band.text} numberOfLines={2}>
          {teaser.name}
        </AppText>
        <View style={styles.bannerCta}>
          <AppText variant="label" color={band.text}>
            {cta}
          </AppText>
          <Ionicons name="arrow-forward" size={16} color={band.text} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  hero: { borderRadius: HERO_RADIUS, padding: SPACE.lg, gap: SPACE.sm, overflow: "hidden" },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -90, right: -70 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  feeRow: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SPACE.md, marginTop: SPACE.xs },
  steps: { flexDirection: "row", gap: SPACE.sm },
  step: { flex: 1, alignItems: "center", gap: SPACE.xs },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  method: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  numberRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.xs },
  number: { fontVariant: ["tabular-nums"], letterSpacing: 0.3 },
  copy: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm, paddingVertical: 2, minHeight: 24, justifyContent: "center" },
  qr: { width: 84, height: 84, borderRadius: RADIUS.md, backgroundColor: "#fff" },
  drop: { minHeight: 140, borderRadius: RADIUS.lg, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: SPACE.sm, padding: SPACE.sm },
  preview: { width: "100%", height: 220, borderRadius: RADIUS.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  chip: { minHeight: TOUCH, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  bannerShadow: { borderRadius: HERO_RADIUS, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  banner: { borderRadius: HERO_RADIUS, padding: SPACE.lg, gap: SPACE.xs, overflow: "hidden" },
  bannerCta: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, marginTop: SPACE.xs },
});
