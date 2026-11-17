/**
 * TODAY (the tab root, TRACKER.md §4): the hero countdown with one-tap log,
 * this week, today's list, low vials with a neutral Reorder, a check-in nudge,
 * the user's protocols and the disclaimer footer. No protocols → EmptyToday.
 */
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { ShopProduct } from "@shop-contract";
import { useCatalog } from "@/features/shop/hooks";
import { draftDose, logScheduledDose, skipDose, undoLog, undoSkip, useProtocols, useTrackerState, type TodayView as TodayData } from "../../hooks";
import { dayKey } from "../../lib/ids";
import { siteLabel, siteStates } from "../../lib/sites";
import type { Slot } from "../../lib/today";
import type { DoseLog, Protocol } from "../../lib/types";
import { withVialMix } from "../../lib/vials";
import { EmptyToday } from "../EmptyToday";
import { Card, DisclaimerFooter, haptic, SectionHeader, TText } from "../kit";
import { NextDoseCard, type SiteHint } from "../NextDoseCard";
import { trackerHref } from "../routes";
import { SkipSheet } from "../SkipSheet";
import { TSPACE } from "../theme";
import { showTrackerToast } from "../toast";
import { CheckInNudge, SuppliesCard, ProtocolStrip } from "../TodayCards";
import { TodayList } from "../TodayList";
import { WeekDots } from "../WeekDots";

const MIN_FUZZY_NAME = 4;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The shop product a protocol was made from (catalogId), else one whose name matches. */
export function productFor(protocol: Protocol | null, products: readonly ShopProduct[]): string | null {
  if (!protocol) return null;
  if (protocol.catalogId && products.some((p) => p.id === protocol.catalogId)) return protocol.catalogId;
  const name = norm(protocol.name);
  if (!name) return null;
  const exact = products.find((p) => norm(p.name) === name);
  if (exact) return exact.id;
  if (name.length < MIN_FUZZY_NAME) return null;
  return products.find((p) => norm(p.name).startsWith(name) || name.startsWith(norm(p.name)))?.id ?? null;
}

/** Logs every slot with its defaults and raises one toast with Undo. */
export function quickLog(slots: readonly Slot[], names: ReadonlyMap<string, Protocol>, isFirstDose: boolean): DoseLog[] {
  const now = new Date();
  const logged = slots.map((s) => logScheduledDose(s.protocolId, s.at, now)).filter((d): d is DoseLog => d !== null);
  if (logged.length === 0) return logged;
  haptic("success");
  const first = logged[0];
  const what = logged.length > 1 ? `${logged.length} doses` : (names.get(first.protocolId ?? "")?.name ?? first.name);
  const where = logged.length === 1 && first.site ? ` · ${siteLabel(first.site)}` : "";
  showTrackerToast({
    message: isFirstDose ? `First dose logged. Nice start.` : `Logged ${what}${where}`,
    icon: isFirstDose ? "sparkles" : "checkmark",
    undo: () => undoLog(logged.map((d) => d.id)),
  });
  return logged;
}

/** `today` = useToday(now) from the tab (computed once there for the header streak too). */
export function TodayView({ now, today }: { now: Date; today: TodayData }) {
  const { protocols } = useProtocols();
  const { data } = useTrackerState();
  const catalog = useCatalog();
  const [skipping, setSkipping] = useState<Slot | null>(null);

  const byId = useMemo(() => new Map(protocols.map((p) => [p.id, withVialMix(p, data.vials)] as const)), [protocols, data.vials]);
  const plan = today.plan;
  const first = plan.next.length === 1 ? plan.next[0] : null;

  const site = useMemo<SiteHint | null>(() => {
    if (!first) return null;
    const draft = draftDose(first.protocolId, first.at, now);
    if (!draft?.site) return null;
    return { site: draft.site, state: siteStates(data.doses, now)[draft.site].state };
    // draftDose reads the store snapshot: re-derive when the doses change.
  }, [first, now, data.doses]);

  if (plan.mode === "empty") return <EmptyToday now={now} />;

  const products = catalog.data?.products ?? [];
  const isFirstDose = data.doses.length === 0;
  const openLog = (slot: Slot) => router.push(trackerHref.log({ protocolId: slot.protocolId, slot: slot.at.toISOString() }));
  const shown = protocols.filter((p) => p.status !== "archived");

  return (
    <View style={styles.wrap}>
      <NextDoseCard
        plan={plan}
        protocols={byId}
        now={now}
        site={site}
        onLog={(slots) => quickLog(slots, byId, isFirstDose)}
        onAdjust={openLog}
        onSkip={setSkipping}
        onLogOther={() => router.push(trackerHref.log())}
      />

      <Card>
        <SectionHeader
          title="This week"
          right={
            today.consistency.pct !== null ? (
              <TText variant="meta" color="soft" tabular>{`${today.consistency.pct}% on schedule`}</TText>
            ) : undefined
          }
        />
        <WeekDots days={today.week} today={dayKey(now)} onDay={(day) => router.setParams({ view: "calendar", date: day })} />
      </Card>

      <TodayList
        plan={plan}
        protocols={byId}
        now={now}
        onLog={(s) => quickLog([s], byId, isFirstDose)}
        onOpenSlot={openLog}
        onOpenDose={(d) => router.push(trackerHref.log({ doseId: d.id }))}
        onSkip={setSkipping}
        onUndoSkip={(s) => {
          if (!s.skip) return;
          haptic("tap");
          undoSkip(s.skip.id);
        }}
      />

      <SuppliesCard
        items={today.lowVials}
        now={now}
        productFor={(v) => productFor(v.protocol, products)}
        onReorder={(id) => router.push(trackerHref.product(id))}
        onOpen={(v) => router.push(trackerHref.vial({ id: v.vial.id }))}
      />

      {!today.checkin ? <CheckInNudge onPress={() => router.push(trackerHref.checkin(dayKey(now)))} /> : null}

      {shown.length > 0 ? <ProtocolStrip protocols={shown} onOpen={(id) => router.push(trackerHref.protocol(id))} onAdd={() => router.push(trackerHref.protocolEdit())} /> : null}

      <DisclaimerFooter />

      <SkipSheet
        title={skipping ? (byId.get(skipping.protocolId)?.name ?? "dose") : null}
        onClose={() => setSkipping(null)}
        onSkip={(reason, note) => {
          if (skipping) {
            const skip = skipDose({ protocolId: skipping.protocolId, scheduledFor: skipping.at.toISOString(), reason, note });
            showTrackerToast({ message: `Skipped ${byId.get(skipping.protocolId)?.name ?? "dose"}`, icon: "play-skip-forward", undo: () => undoSkip(skip.id) });
          }
          setSkipping(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.lg },
});
