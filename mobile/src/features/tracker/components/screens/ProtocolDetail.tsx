/**
 * PROTOCOL DETAIL: what and how much, the schedule in words, the next doses,
 * adherence (same formula as Today — lib/consistency), the vial in use, recent
 * logs, and pause / resume / end / delete (each confirmed). Edit opens the
 * setup wizard on Review.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deleteProtocol, endProtocol, pauseProtocol, useNow, useProtocols, useTrackerState } from "../../hooks";
import { consistency, cyclePosition } from "../../lib/consistency";
import { formatDose, unitLabel } from "../../lib/dose-math";
import { dayKey, formatDay, WEEKDAY_SHORT } from "../../lib/ids";
import { describeSchedule, nextOccurrences } from "../../lib/schedule";
import { siteLabel } from "../../lib/sites";
import { activeVial, vialNumber, vialStatus, withVialMix } from "../../lib/vials";
import { confirm } from "../dialog";
import { clock, plural, relativeDay } from "../format";
import { Card, DisclaimerFooter, Dot, EmptyState, IconButton, Pill, PressButton, SectionHeader, TText } from "../kit";
import { ProgressBar, ProgressRing } from "../ProgressRing";
import { trackerHref } from "../routes";
import { vialLeftText } from "../vial-model";
import { TOUCH_MIN, TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast, UndoToast } from "../toast";

const NEXT_SHOWN = 3;
const RECENT_SHOWN = 5;

function back(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

/** "Today", "Tomorrow", else "Mon, Nov 23" — a bare "Mon" next to full dates read as a typo. */
function upcomingDay(at: Date, now: Date): string {
  const word = relativeDay(at, now);
  return word === "Today" || word === "Tomorrow" ? word : `${WEEKDAY_SHORT[at.getDay()]}, ${formatDay(dayKey(at))}`;
}

export function ProtocolDetail() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoaded, data } = useTrackerState();
  const { byId } = useProtocols();
  const found = byId.get(String(id ?? ""));
  const protocol = useMemo(() => (found ? withVialMix(found, data.vials) : undefined), [found, data.vials]);

  const view = useMemo(() => {
    if (!protocol) return null;
    const own = { doses: data.doses.filter((d) => d.protocolId === protocol.id), skips: data.skips.filter((s) => s.protocolId === protocol.id) };
    const vial = activeVial(data.vials, protocol.id);
    return {
      next: protocol.status === "active" ? nextOccurrences(protocol, now, NEXT_SHOWN) : [],
      stats: consistency([protocol], own.doses, own.skips, now),
      vial: vial ? { status: vialStatus(vial, data.doses, protocol, now), no: vialNumber(data.vials, vial) } : null,
      cycle: cyclePosition(protocol, now),
      recent: [...own.doses].sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, RECENT_SHOWN),
      count: own.doses.length,
    };
  }, [protocol, data, now]);

  const bar = (
    <View style={[styles.bar, { paddingTop: insets.top + TSPACE.xs }]}>
      <IconButton icon="chevron-back" label="Back" onPress={back} />
      <View style={styles.fill} />
      {protocol ? <PressButton label="Edit" icon="create-outline" tone="soft" size="sm" onPress={() => router.push(trackerHref.protocolEdit({ id: protocol.id }))} /> : null}
    </View>
  );

  if (!protocol || !view) {
    return (
      <View style={[styles.screen, { backgroundColor: th.bg }]}>
        {bar}
        {isLoaded ? <EmptyState icon="help-circle-outline" title="Not found" body="This protocol isn’t on this phone any more." /> : null}
      </View>
    );
  }

  const statusPill = protocol.status === "active" ? <Pill label="Active" status="done" icon="play" /> : protocol.status === "paused" ? <Pill label="Paused" icon="pause" /> : <Pill label="Ended" icon="stop" />;
  const pct = view.stats.pct;
  const mixText = protocol.mix
    ? `${protocol.mix.vialAmount} ${unitLabel(protocol.mix.vialUnit)} vial + ${protocol.mix.waterMl} mL water`
    : null;

  const onPause = () => {
    const pausing = protocol.status === "active";
    pauseProtocol(protocol.id, pausing);
    showTrackerToast({ message: pausing ? `${protocol.name} paused. Past days stay as they were` : `${protocol.name} resumed`, icon: pausing ? "pause" : "play" });
  };
  const onEnd = () =>
    confirm(`End ${protocol.name}?`, "It stops scheduling doses from today. Your history stays.", "End protocol", () => {
      endProtocol(protocol.id, dayKey(now));
      showTrackerToast({ message: `${protocol.name} ended`, icon: "stop" });
    });
  const onDelete = () =>
    confirm(`Delete ${protocol.name}?`, `This removes it with ${plural(view.count, "logged dose")}, its skips and vials, on every phone. It can’t be undone.`, "Delete", () => {
      deleteProtocol(protocol.id);
      router.replace(trackerHref.home());
    });

  return (
    <View style={[styles.screen, { backgroundColor: th.bg }]}>
      {bar}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TSPACE.xxxl }]}>
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Dot color={protocol.color} size={16} />
            <TText variant="display" accessibilityRole="header" style={styles.fill}>
              {protocol.name}
            </TText>
          </View>
          {statusPill}
          <View style={styles.summary} accessible accessibilityLabel={`${formatDose(protocol.dose)} each dose, ${describeSchedule(protocol)}${mixText ? `, ${mixText}` : ""}`}>
            <TText variant="title" tabular>
              {formatDose(protocol.dose)}
            </TText>
            <TText variant="body" color="soft">
              {describeSchedule(protocol)}
            </TText>
            {mixText ? (
              <TText variant="meta" color="faint">
                {mixText}
              </TText>
            ) : null}
          </View>
          {view.cycle ? <Pill label={view.cycle.label} tone="brand" icon="repeat" /> : null}
        </View>

        <Card style={styles.statsCard}>
          <ProgressRing size={84} stroke={9} progress={(pct ?? 0) / 100} color={th.status.done.solid} label={pct !== null ? `${pct} percent on schedule, last 30 days` : "Not enough doses yet"}>
            <TText variant="number" tabular>
              {pct !== null ? `${pct}%` : "—"}
            </TText>
          </ProgressRing>
          <View style={styles.fill}>
            <TText variant="micro" color="faint">
              On schedule · 30 days
            </TText>
            <TText variant="bodyStrong" tabular>{`${view.stats.taken30} taken · ${view.stats.missed30} missed`}</TText>
            <TText variant="meta" color="soft" tabular>
              {view.stats.run > 0 ? `${plural(view.stats.run, "dose")} in a row` : "Skips never count against you"}
            </TText>
          </View>
        </Card>

        {view.next.length > 0 ? (
          <Card>
            <SectionHeader title="Coming up" />
            {view.next.map((o) => (
              <View key={o.key} style={styles.line}>
                <TText variant="bodyStrong" style={styles.fill}>
                  {upcomingDay(o.at, now)}
                </TText>
                <TText variant="body" color="soft" tabular>
                  {clock(o.at)}
                </TText>
              </View>
            ))}
          </Card>
        ) : null}

        {view.vial ? (
          <Card>
            <SectionHeader title={`Vial ${view.vial.no} · in use`} action={{ label: "All vials", onPress: () => router.push(trackerHref.vials()) }} />
            <ProgressBar progress={view.vial.status.pct / 100} color={view.vial.status.isLow ? th.status.low.solid : th.brand} label={`${view.vial.status.pct} percent left`} height={10} />
            {view.vial.status.dosesLeft === 0 || view.vial.status.pct <= 0 ? (
              <>
                <TText variant="meta" color={th.status.missed.text}>
                  Empty — log your next dose from a new vial.
                </TText>
                <PressButton label="Start a new vial" icon="add" tone="secondary" size="sm" onPress={() => router.push(trackerHref.vial({ protocolId: protocol.id }))} />
              </>
            ) : (
              <TText variant="meta" color={view.vial.status.isLow ? th.status.low.text : "soft"} tabular>
                {vialLeftText(view.vial.status, now)}
              </TText>
            )}
          </Card>
        ) : null}

        {view.recent.length > 0 ? (
          <Card>
            <SectionHeader title="Recent doses" />
            {view.recent.map((d) => {
              const at = new Date(d.takenAt);
              const label = `${relativeDay(at, now)} ${clock(at)}`;
              const detail = [formatDose(d.dose), d.site ? siteLabel(d.site) : null].filter(Boolean).join(" · ");
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}, ${detail}`}
                  accessibilityHint="Edit this dose"
                  onPress={() => router.push(trackerHref.log({ doseId: d.id }))}
                  style={({ pressed }) => [styles.recent, { borderTopColor: th.line }, pressed ? { opacity: 0.6 } : null]}
                >
                  <View style={styles.fill}>
                    <TText variant="bodyStrong" tabular>
                      {label}
                    </TText>
                    <TText variant="meta" color="soft" numberOfLines={2}>
                      {detail}
                    </TText>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={th.inkFaint} />
                </Pressable>
              );
            })}
          </Card>
        ) : null}

        <View style={styles.actions}>
          {protocol.status !== "archived" ? (
            <PressButton label={protocol.status === "paused" ? "Resume" : "Pause"} icon={protocol.status === "paused" ? "play" : "pause"} tone="secondary" size="md" onPress={onPause} />
          ) : (
            <PressButton label="Restart" icon="play" tone="secondary" size="md" onPress={() => pauseProtocol(protocol.id, false)} />
          )}
          {protocol.status !== "archived" ? <PressButton label="End protocol" icon="stop-circle-outline" tone="secondary" size="md" onPress={onEnd} /> : null}
          <PressButton label="Delete protocol" icon="trash-outline" tone="danger" size="md" onPress={onDelete} />
        </View>
        <DisclaimerFooter />
      </ScrollView>
      <UndoToast bottom={insets.bottom + TSPACE.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 2, marginTop: TSPACE.xs },
  screen: { flex: 1 },
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.xs },
  content: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, gap: TSPACE.lg },
  titleBlock: { gap: TSPACE.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  statsCard: { flexDirection: "row", alignItems: "center", gap: TSPACE.lg },
  line: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  recent: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: TOUCH_MIN + 8, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { gap: TSPACE.sm },
});
