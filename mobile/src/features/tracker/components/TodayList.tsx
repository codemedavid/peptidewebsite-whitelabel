/**
 * Today's doses (ported from MamaMicaGlow TodayList, restyled): grouped by time
 * of day, each row says its state in an icon AND words —
 *   taken ✓ "Taken 8:05 AM · Left thigh" (tap → edit)
 *   due     "Due now" + a one-tap Log
 *   later   its time
 *   missed  "Missed" + Skip / Log
 *   skipped "Skipped · Rest day" + Undo
 * plus doses logged outside the schedule ("Also logged").
 */
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatTime } from "../lib/ids";
import { siteLabel } from "../lib/sites";
import { DUE_EARLY_MS, type Slot, type TodayPlan } from "../lib/today";
import { SKIP_REASON_LABEL, type DoseLog, type Protocol } from "../lib/types";
import { clock, countdown, doseParts } from "./format";
import { Card, PressButton, SectionHeader, TText } from "./kit";
import { TOUCH_MIN, TSPACE, useTrackerTheme } from "./theme";

type Props = {
  plan: TodayPlan;
  protocols: ReadonlyMap<string, Protocol>;
  now: Date;
  onLog: (slot: Slot) => void;
  onOpenSlot: (slot: Slot) => void;
  onOpenDose: (dose: DoseLog) => void;
  onSkip: (slot: Slot) => void;
  onUndoSkip: (slot: Slot) => void;
};

/**
 * One heading per part of the day ("Morning"), not per clock time: each row
 * already says its own time, so "Morning · 8:00" + "Morning · 9:00" was noise.
 */
function byPartOfDay(groups: TodayPlan["groups"]): { key: string; label: string; slots: Slot[] }[] {
  const out: { key: string; label: string; slots: Slot[] }[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && last.label === g.label) last.slots.push(...g.slots);
    else out.push({ key: g.time, label: g.label, slots: [...g.slots] });
  }
  return out;
}

export function TodayList({ plan, protocols, now, onLog, onOpenSlot, onOpenDose, onSkip, onUndoSkip }: Props) {
  const hasRows = plan.slots.length > 0 || plan.extras.length > 0;
  if (!hasRows) return null;
  return (
    <Card>
      <SectionHeader
        title="Today"
        right={
          plan.total > 0 ? (
            <TText variant="meta" color="soft" tabular accessibilityLabel={`${plan.taken} of ${plan.total} doses taken`}>
              {`${plan.taken} of ${plan.total} taken`}
            </TText>
          ) : undefined
        }
      />
      {byPartOfDay(plan.groups).map((g) => (
        <View key={g.key} style={styles.group}>
          <TText variant="micro" color="faint" accessibilityRole="header">
            {g.label}
          </TText>
          {g.slots.map((s) => {
            const protocol = protocols.get(s.protocolId);
            return protocol ? (
              <SlotRow key={s.key} slot={s} protocol={protocol} now={now} onLog={onLog} onOpenSlot={onOpenSlot} onOpenDose={onOpenDose} onSkip={onSkip} onUndoSkip={onUndoSkip} />
            ) : null;
          })}
        </View>
      ))}
      {plan.extras.length > 0 ? (
        <View style={styles.group}>
          <TText variant="micro" color="faint">
            Also logged
          </TText>
          {plan.extras.map((d) => (
            <ExtraRow key={d.id} dose={d} onOpen={onOpenDose} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Same words as the hero: "Due now", or "2h 5m late" once past the grace window. */
function dueWord(at: Date, now: Date): string {
  const cd = countdown(at, now);
  return cd.state === "late" ? `${cd.value} late` : "Due now";
}

type RowProps = Omit<Props, "plan" | "protocols"> & { slot: Slot; protocol: Protocol };

function SlotRow({ slot: s, protocol, now, onLog, onOpenSlot, onOpenDose, onSkip, onUndoSkip }: RowProps) {
  const th = useTrackerTheme();
  const isDue = s.state === "open" && now.getTime() >= s.at.getTime() - DUE_EARLY_MS;
  const dose = doseParts(s.dose?.dose ?? protocol.dose);
  const detail =
    s.state === "taken" && s.dose
      ? `Taken ${clock(new Date(s.dose.takenAt))}${s.dose.site ? ` · ${siteLabel(s.dose.site)}` : ""}`
      : s.state === "skipped" && s.skip
        ? `Skipped · ${SKIP_REASON_LABEL[s.skip.reason]}`
        : s.state === "missed"
          ? `Missed · was due ${formatTime(s.time)}`
          : isDue
            ? `${dueWord(s.at, now)} · ${dose.main}`
            : dose.main;
  const detailColor = s.state === "missed" ? th.status.missed.text : s.state === "taken" ? th.status.done.text : isDue ? th.brandText : th.inkSoft;

  const onPress = () => (s.dose ? onOpenDose(s.dose) : onOpenSlot(s));
  return (
    <View style={[styles.row, { borderTopColor: th.line }]}>
      <View style={styles.rowTop}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${protocol.name}, ${detail}`}
          accessibilityHint={s.dose ? "Edit this dose" : "Open the log sheet"}
          style={({ pressed }) => [styles.rowMain, pressed ? { opacity: 0.6 } : null]}
        >
          <StateIcon slot={s} color={protocol.color} isDue={isDue} />
          <View style={styles.fill}>
            <TText variant="bodyStrong" color={s.state === "skipped" ? "faint" : "ink"} numberOfLines={2}>
              {protocol.name}
            </TText>
            <TText variant="meta" color={detailColor} numberOfLines={2}>
              {detail}
            </TText>
          </View>
          {s.state === "open" && !isDue ? (
            <TText variant="meta" color="soft" tabular>
              {formatTime(s.time)}
            </TText>
          ) : null}
        </Pressable>
        {isDue ? <PressButton label="Log" size="sm" icon="checkmark" hapticKind="none" accessibilityLabel={`Log ${protocol.name} now`} onPress={() => onLog(s)} /> : null}
        {s.state === "skipped" ? <PressButton label="Undo" size="sm" tone="ghost" accessibilityLabel={`Undo skip of ${protocol.name}`} onPress={() => onUndoSkip(s)} /> : null}
      </View>
      {s.state === "missed" ? (
        <View style={styles.missedActions}>
          <PressButton label="Skip" size="sm" tone="secondary" accessibilityLabel={`Skip ${protocol.name}`} onPress={() => onSkip(s)} style={styles.fill} />
          <PressButton label="Log it" size="sm" tone="soft" icon="checkmark" accessibilityLabel={`Log ${protocol.name}`} onPress={() => onOpenSlot(s)} style={styles.fill} />
        </View>
      ) : null}
    </View>
  );
}

function ExtraRow({ dose, onOpen }: { dose: DoseLog; onOpen: (d: DoseLog) => void }) {
  const th = useTrackerTheme();
  const at = clock(new Date(dose.takenAt));
  return (
    <Pressable
      onPress={() => onOpen(dose)}
      accessibilityRole="button"
      accessibilityLabel={`${dose.name}, taken at ${at}`}
      style={({ pressed }) => [styles.row, styles.rowMain, { borderTopColor: th.line }, pressed ? { opacity: 0.6 } : null]}
    >
      <View style={[styles.icon, { backgroundColor: th.status.done.solid }]}>
        <Ionicons name="checkmark" size={15} color={th.status.done.soft} />
      </View>
      <View style={styles.fill}>
        <TText variant="bodyStrong" numberOfLines={2}>
          {dose.name}
        </TText>
        <TText variant="meta" color={th.status.done.text}>{`Taken ${at}${dose.site ? ` · ${siteLabel(dose.site)}` : ""}`}</TText>
      </View>
    </Pressable>
  );
}

function StateIcon({ slot, color, isDue }: { slot: Slot; color: string; isDue: boolean }) {
  const th = useTrackerTheme();
  if (slot.state === "taken") {
    return (
      <View style={[styles.icon, { backgroundColor: th.status.done.solid }]}>
        <Ionicons name="checkmark" size={15} color={th.status.done.soft} />
      </View>
    );
  }
  if (slot.state === "missed") {
    return (
      <View style={[styles.icon, { backgroundColor: th.status.missed.soft }]}>
        <Ionicons name="close" size={15} color={th.status.missed.solid} />
      </View>
    );
  }
  if (slot.state === "skipped") {
    return (
      <View style={[styles.icon, { backgroundColor: th.surfaceAlt }]}>
        <Ionicons name="remove" size={15} color={th.inkFaint} />
      </View>
    );
  }
  return <View style={[styles.icon, { borderWidth: 2.5, borderColor: isDue ? th.brand : color }]} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: 2 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: TSPACE.xs },
  rowTop: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: 56, paddingVertical: 6 },
  icon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  missedActions: { flexDirection: "row", gap: TSPACE.sm, paddingLeft: 26 + TSPACE.md, paddingBottom: TSPACE.sm, minHeight: TOUCH_MIN },
});
