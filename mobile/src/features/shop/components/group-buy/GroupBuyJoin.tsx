import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GroupBuyJoinState, ShopGroupBuyTeaser } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { SkeletonList } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";
import { useGroupBuyJoin, useGroupBuyJoinActions } from "../../hooks";
import { useShop } from "../../ShopProvider";
import { FormSection, Notice } from "../ShopUI";
import { groupBuyBand, LiveDot, RoundClock } from "./GroupBuyParts";
import { JOIN_HERO_RADIUS } from "./JoinBanner";
import { JoinForm } from "./JoinForm";
import { PayStep, ProofSent } from "./JoinPay";
import { JoinStepper } from "./JoinStepper";

/**
 * Paid Access join (src/modules/paid-access) — what a shopper sees instead of a gated
 * round until they're in: the round's teaser, a stepper in the server's own
 * words, and ONE primary action (join / fill the form / pay). The server has
 * already left the round's products and prices out of the catalog. Once the
 * member is in, the catalog refetch hands GroupBuyScreen the real round.
 */

/** Statuses a member may leave from (core/machine.ts `cancel`). */
const LEAVABLE = new Set(["waitlisted", "form_pending", "payment_pending"]);

const REFUND_COPY: Record<string, { tone: "info" | "success"; text: string }> = {
  pending: { tone: "info", text: "You're owed a refund — the store will send it back to you." },
  processing: { tone: "info", text: "Your refund is on its way." },
  refunded: { tone: "success", text: "Your payment was refunded." },
};

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

type ScreenProps = { teaser: ShopGroupBuyTeaser; onRefreshCatalog: () => void };

export function GroupBuyJoinScreen({ teaser, onRefreshCatalog }: ScreenProps) {
  const t = useTheme();
  const shop = useShop();
  const q = useGroupBuyJoin(teaser.id);
  const refresh = () => {
    void q.refetch();
    onRefreshCatalog();
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.bg }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={refresh} tintColor={t.brand.link} />}
    >
      <JoinHero teaser={teaser} />
      {shop.mode !== "customer" ? (
        <FormSection title="Sign in to join" hint="Your place in this group buy is tied to your account.">
          <Button label="Sign in" icon="log-in-outline" onPress={() => router.push("/sign-in")} />
        </FormSection>
      ) : q.isPending ? (
        <SkeletonList rows={2} />
      ) : q.isError || !q.data ? (
        <Notice tone="danger" icon="alert-circle-outline" action={<Button label="Try again" variant="secondary" onPress={() => void q.refetch()} />}>
          {errorText(q.error, "We couldn't load this group buy.")}
        </Notice>
      ) : (
        <JoinBody state={q.data} roundId={teaser.id} onOpenRound={onRefreshCatalog} />
      )}
    </ScrollView>
  );
}

function JoinHero({ teaser }: { teaser: ShopGroupBuyTeaser }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  const live = teaser.state === "live";
  const summary = teaser.visibility === "summary" ? teaser.summary : null;
  const facts: string[] = [];
  if (summary?.productCount) facts.push(`${summary.productCount} product${summary.productCount === 1 ? "" : "s"}`);
  if (summary?.maxSlots) facts.push(`${summary.slotsTaken}/${summary.maxSlots} slots taken`);
  if (summary?.deliveryEta) facts.push(`Delivery ${summary.deliveryEta}`);

  return (
    <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={[styles.glow, { backgroundColor: band.glow }]} pointerEvents="none" />
      <View style={styles.eyebrow}>
        <LiveDot live={live} />
        <AppText variant="overline" color={band.text}>
          {live ? "Members-only group buy" : "Coming soon · members only"}
        </AppText>
      </View>
      <AppText variant="title" brandFont color={band.text} numberOfLines={3}>
        {teaser.name}
      </AppText>
      {teaser.copy?.intro.trim() ? (
        <AppText variant="body" color={band.text}>
          {teaser.copy.intro.trim()}
        </AppText>
      ) : null}
      {summary?.description ? (
        <AppText variant="body" color={band.muted} numberOfLines={4}>
          {summary.description}
        </AppText>
      ) : null}
      {facts.length ? (
        <AppText variant="caption" color={band.muted}>
          {facts.join("  ·  ")}
        </AppText>
      ) : null}
      {live && teaser.endsAt ? <RoundClock endsAt={teaser.endsAt} color={band.text} boxColor={band.chip} /> : null}
      {teaser.steps.length > 0 ? (
        <View style={[styles.wayIn, { borderTopColor: band.line }]} accessible accessibilityLabel={`How to get in: ${teaser.steps.join(", then ")}`}>
          <AppText variant="overline" color={band.muted}>
            How to get in
          </AppText>
          <View style={styles.chain}>
            {teaser.steps.map((s, i) => (
              <View key={`${i}-${s}`} style={styles.chainItem}>
                <View style={[styles.chainChip, { backgroundColor: band.chip }]}>
                  <AppText variant="label" color={band.text}>
                    {s}
                  </AppText>
                </View>
                {i < teaser.steps.length - 1 ? <Ionicons name="chevron-forward" size={14} color={band.muted} /> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </LinearGradient>
  );
}

type BodyProps = { state: GroupBuyJoinState; roundId: string; onOpenRound: () => void };

function JoinBody({ state, roundId, onOpenRound }: BodyProps) {
  const { join, submitForm, cancel } = useGroupBuyJoinActions(roundId);
  const { stepper, status } = state;
  const action = stepper.action;
  const paid = !!state.proof || stepper.steps.some((s) => s.key === "payment" && s.state === "done");
  const canLeave = !!status && (LEAVABLE.has(status) || (status === "approval_pending" && !paid));
  const full = state.capacity.maxSlots !== null && state.capacity.slotsTaken >= state.capacity.maxSlots;
  const refund = status === "rejected" ? REFUND_COPY[state.refundStatus] : undefined;
  const actionError = join.error ?? cancel.error;

  const leave = () =>
    Alert.alert("Leave this group buy?", "Your slot is released. You can join again later if there's still room.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => cancel.mutate() },
    ]);

  return (
    <View style={{ gap: SPACE.md }}>
      <JoinStepper stepper={stepper} canAccess={state.canAccess} />

      {refund ? (
        <Notice tone={refund.tone} icon="cash-outline">
          {refund.text}
        </Notice>
      ) : null}
      {action?.kind === "join" && !state.window.open && state.window.message ? (
        <Notice tone="neutral" icon="calendar-outline">
          {state.window.message}
        </Notice>
      ) : null}
      {action?.kind === "join" && state.window.open && full ? (
        <Notice tone="warning" icon="people-outline">
          {state.capacity.waitlist ? "Every slot is taken — joining puts you on the waitlist." : "Every slot is taken right now."}
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="danger" icon="alert-circle-outline">
          {errorText(actionError, "That didn't go through. Please try again.")}
        </Notice>
      ) : null}

      {action?.kind === "join" ? (
        <Button label={action.label} icon="people-outline" loading={join.isPending} disabled={!state.canJoin} onPress={() => join.mutate()} />
      ) : null}
      {action?.kind === "fill_form" ? (
        <JoinForm
          questions={state.formQuestions}
          submitting={submitForm.isPending}
          error={submitForm.error}
          onSubmit={(answers) => submitForm.mutate(answers)}
        />
      ) : null}
      {action?.kind === "pay" ? <PayStep state={state} roundId={roundId} /> : null}

      {status === "payment_review" || (status === "approval_pending" && state.proof) ? <ProofSent state={state} roundId={roundId} /> : null}

      {state.canAccess ? <Button label="Open the group buy" icon="arrow-forward" onPress={onOpenRound} /> : null}

      {canLeave ? <Button label="Leave this group buy" variant="ghost" loading={cancel.isPending} onPress={leave} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  hero: { borderRadius: JOIN_HERO_RADIUS, padding: SPACE.lg, gap: SPACE.sm, overflow: "hidden" },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -90, right: -70 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  wayIn: { gap: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SPACE.md, marginTop: SPACE.xs },
  chain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: SPACE.sm, columnGap: SPACE.xs },
  chainItem: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, maxWidth: "100%" },
  chainChip: { borderRadius: 999, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, flexShrink: 1 },
});
