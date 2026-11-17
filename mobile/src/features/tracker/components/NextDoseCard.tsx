/**
 * The hero (TRACKER.md §4 "Today"): a big live countdown to the next dose,
 * what and how much, the suggested site with its recency, and ONE big
 * "Log dose" that logs instantly with everything pre-filled (dose, site, vial).
 * "Adjust" opens the log sheet; "Skip" asks for a reason. Doses due at the same
 * time are grouped ("2 doses · 8:00 PM" → "Log both").
 * Rest and all-done days say when the next dose is — no pop-ups.
 */
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { siteLabel, type SiteState } from "../lib/sites";
import type { Slot, TodayPlan } from "../lib/today";
import type { Protocol, SiteId } from "../lib/types";
import { clock, countdown, doseParts, durationText, relativeDay, SITE_LOOK } from "./format";
import { Dot, PressButton, Pill, TText } from "./kit";
import { TRADIUS, TSPACE, useTrackerTheme } from "./theme";

export type SiteHint = { site: SiteId; state: SiteState };

type Props = {
  plan: TodayPlan;
  /** Protocols with the vial-in-use mix applied (lib/vials withVialMix). */
  protocols: ReadonlyMap<string, Protocol>;
  now: Date;
  /** The site a one-tap log will record (rotation on), with its recency. */
  site: SiteHint | null;
  onLog: (slots: Slot[]) => void;
  onAdjust: (slot: Slot) => void;
  onSkip: (slot: Slot) => void;
  /** Rest / done days: log an as-needed or extra dose. */
  onLogOther: () => void;
};

export function NextDoseCard({ plan, protocols, now, site, onLog, onAdjust, onSkip, onLogOther }: Props) {
  const th = useTrackerTheme();
  const first = plan.next[0];
  const protocol = first ? protocols.get(first.protocolId) : undefined;
  const key = first ? first.key : plan.mode;

  return (
    <Animated.View key={key} entering={FadeIn.duration(260)}>
      <LinearGradient colors={[th.heroFrom, th.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, th.shadow.float]}>
        {!first || !protocol ? (
          <RestBody plan={plan} now={now} onLogOther={onLogOther} />
        ) : (
          <DueBody plan={plan} first={first} protocol={protocol} protocols={protocols} now={now} site={site} onLog={onLog} onAdjust={onAdjust} onSkip={onSkip} />
        )}
      </LinearGradient>
    </Animated.View>
  );
}

function DueBody({
  plan,
  first,
  protocol,
  protocols,
  now,
  site,
  onLog,
  onAdjust,
  onSkip,
}: Omit<Props, "onLogOther"> & { first: Slot; protocol: Protocol }) {
  const th = useTrackerTheme();
  const cd = countdown(first.at, now);
  const isGroup = plan.next.length > 1;
  const isUpcoming = cd.state === "upcoming";
  const dose = doseParts(protocol.dose);
  const siteLook = site ? SITE_LOOK[site.state] : null;
  // Due or late: lead with WHAT to take; the lateness is said once, in the pill.
  // Upcoming: the live countdown is the headline.
  const eyebrow = isGroup
    ? `${plan.next.length} doses · ${clock(first.at)}`
    : isUpcoming
      ? "Next dose"
      : cd.state === "late"
        ? `Was due ${clock(first.at)}`
        : `Due ${clock(first.at)}`;
  const pill = cd.state === "late" ? `${cd.value} late` : cd.state === "due" ? "Due now" : null;

  return (
    <>
      <View style={styles.head}>
        <TText variant="micro" color="onBrandSoft" style={styles.fill}>
          {eyebrow}
        </TText>
        {pill ? <Pill label={pill} tone="onBrand" icon="alarm-outline" /> : null}
      </View>

      {isUpcoming ? (
        <>
          <View accessible accessibilityLabel={`${cd.spoken}, at ${clock(first.at)}`}>
            <TText variant="hero" color="onBrand" tabular numberOfLines={1} style={styles.countdown}>
              {`in ${cd.value}`}
            </TText>
            <TText variant="meta" color="onBrandSoft">{`at ${clock(first.at)}`}</TText>
          </View>
          <View style={[styles.rule, { backgroundColor: th.onBrandLine }]} />
        </>
      ) : null}

      {isGroup ? (
        <View style={styles.group}>
          {plan.next.map((s) => {
            const p = protocols.get(s.protocolId);
            if (!p) return null;
            const d = doseParts(p.dose);
            return (
              <View key={s.key} style={styles.groupRow} accessible accessibilityLabel={`${p.name}, ${d.main}`}>
                <Dot color={p.color} ring={th.onBrand} size={12} />
                <TText variant="headline" color="onBrand" style={styles.fill} numberOfLines={2}>
                  {p.name}
                </TText>
                <TText variant="number" color="onBrand">
                  {d.main}
                </TText>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.what} accessible accessibilityLabel={`${protocol.name}, ${dose.main}${pill ? `, ${pill}` : ""}`}>
          <View style={styles.nameRow}>
            <Dot color={protocol.color} ring={th.onBrand} size={isUpcoming ? 12 : 14} />
            <TText variant={isUpcoming ? "title" : "display"} color="onBrand" style={styles.fill} numberOfLines={2}>
              {protocol.name}
            </TText>
          </View>
          <TText variant={isUpcoming ? "headline" : "title"} color={isUpcoming ? "onBrand" : "onBrandSoft"} tabular>
            {dose.main}
          </TText>
        </View>
      )}

      {site && siteLook && !isGroup ? (
        <View style={[styles.site, { backgroundColor: th.onBrandLine }]} accessible accessibilityLabel={`Suggested site: ${siteLabel(site.site)}, ${siteLook.word}`}>
          <Ionicons name="body-outline" size={18} color={th.onBrand} />
          <TText variant="meta" color="onBrand" style={styles.fill} numberOfLines={2}>
            {siteLabel(site.site)}
          </TText>
          <View style={[styles.siteState, { backgroundColor: th.status[siteLook.status].soft }]}>
            <Dot color={th.status[siteLook.status].solid} size={8} />
            <TText variant="meta" color={th.status[siteLook.status].text} style={styles.small}>
              {siteLook.word}
            </TText>
          </View>
        </View>
      ) : null}

      <PressButton
        label={isGroup ? `Log all ${plan.next.length}` : "Log dose"}
        icon="checkmark-circle"
        tone="onBrand"
        hapticKind="none"
        accessibilityHint="Logs it now with the dose, site and vial shown. You can undo."
        onPress={() => onLog(plan.next)}
      />
      <View style={styles.secondary}>
        <PressButton label="Adjust" icon="options-outline" tone="onBrandGhost" size="sm" onPress={() => onAdjust(first)} accessibilityHint="Change the dose, time, vial or site before logging" style={styles.fill} />
        {!isGroup && cd.state !== "upcoming" ? (
          <PressButton label="Skip" icon="play-skip-forward-outline" tone="onBrandGhost" size="sm" onPress={() => onSkip(first)} style={styles.fill} />
        ) : null}
      </View>
    </>
  );
}

function RestBody({ plan, now, onLogOther }: { plan: TodayPlan; now: Date; onLogOther: () => void }) {
  const th = useTrackerTheme();
  const isDone = plan.mode === "done";
  const after = plan.after;
  const until = after ? durationText((after.at.getTime() - now.getTime()) / 60_000) : null;
  return (
    <>
      <View style={styles.head}>
        <TText variant="micro" color="onBrandSoft" style={styles.fill}>
          {isDone ? "All done today" : "Rest day"}
        </TText>
        <View style={[styles.badge, { backgroundColor: th.onBrandLine }]}>
          <Ionicons name={isDone ? "checkmark-done" : "moon-outline"} size={18} color={th.onBrand} />
        </View>
      </View>
      {after && until ? (
        <View accessible accessibilityLabel={`Next: ${after.protocol.name}, ${relativeDay(after.at, now)} at ${clock(after.at)}, in ${until.long}`}>
          <TText variant="meta" color="onBrandSoft">
            Next dose in
          </TText>
          <TText variant="hero" color="onBrand" tabular numberOfLines={1} style={styles.countdown}>
            {until.short}
          </TText>
          <TText variant="bodyStrong" color="onBrand" numberOfLines={2}>{`${after.protocol.name} · ${relativeDay(after.at, now)} ${clock(after.at)}`}</TText>
        </View>
      ) : (
        <TText variant="headline" color="onBrand">
          {isDone ? "Every dose for today is logged." : "Nothing scheduled ahead."}
        </TText>
      )}
      <PressButton label="Log a dose" icon="add-circle-outline" tone="onBrandGhost" size="md" onPress={onLogOther} accessibilityHint="Log an as-needed or extra dose" />
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: TRADIUS.xl, padding: TSPACE.xl - 4, gap: TSPACE.md },
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: 28 },
  countdown: { marginVertical: -2 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  what: { gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  group: { gap: TSPACE.sm },
  groupRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, flexWrap: "wrap" },
  site: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, paddingHorizontal: TSPACE.md, paddingVertical: TSPACE.sm, borderRadius: TRADIUS.md, flexWrap: "wrap" },
  siteState: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: TRADIUS.pill },
  small: { fontSize: 12, lineHeight: 16 },
  secondary: { flexDirection: "row", gap: TSPACE.sm },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
