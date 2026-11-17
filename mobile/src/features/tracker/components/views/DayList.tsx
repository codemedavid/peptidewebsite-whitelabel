/**
 * The selected day (ported from MamaMicaGlow DayList, extended): every dose
 * with compound, time, amount and site (tap → edit), skips with their reason
 * (tap → undo), missed doses with "Log late" (back-dated to that slot) and
 * "Skip", today's open doses with "Log", and the day's check-in summary
 * (tap → edit; none yet → add). Future days list what's planned.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DayInfo } from "../../lib/consistency";
import { formatDose } from "../../lib/dose-math";
import { formatTime, formatWeekdayDay } from "../../lib/ids";
import { siteLabel } from "../../lib/sites";
import type { Slot } from "../../lib/today";
import { SKIP_REASON_LABEL, type CheckIn, type DoseLog, type Protocol, type WeightUnit } from "../../lib/types";
import { clock } from "../format";
import { Card, haptic, Pill, PressButton, TText, type IconName } from "../kit";
import { TOUCH_MIN, TSPACE, useTrackerTheme } from "../theme";
import { checkInSummary } from "./calendar-model";

type Props = {
  info: DayInfo;
  today: string;
  protocols: ReadonlyMap<string, Protocol>;
  checkin: CheckIn | null;
  weightUnit: WeightUnit;
  /** Protocols resting on this day because of their cycle. */
  offCycle: readonly string[];
  onOpenDose: (dose: DoseLog) => void;
  onLogSlot: (slot: Slot) => void;
  onSkipSlot: (slot: Slot) => void;
  onUndoSkip: (slot: Slot) => void;
  onCheckIn: () => void;
  onAddDose: () => void;
};

export function DayList({ info, today, protocols, checkin, weightUnit, offCycle, onOpenDose, onLogSlot, onSkipSlot, onUndoSkip, onCheckIn, onAddDose }: Props) {
  const isFuture = info.day > today;
  const isToday = info.day === today;
  const hasDoses = info.slots.length > 0 || info.extras.length > 0;
  const heading = `${isToday ? "Today · " : ""}${formatWeekdayDay(info.day)}`;

  return (
    <Card>
      <TText variant="headline" accessibilityRole="header">
        {heading}
      </TText>
      <View>
        {info.slots.map((s) => {
          const p = protocols.get(s.protocolId) ?? null;
          if (s.dose) return <DoseRow key={s.key} dose={s.dose} protocol={p} slot={s} onPress={onOpenDose} />;
          if (s.skip) return <SkipRow key={s.key} slot={s} protocol={p} onPress={onUndoSkip} />;
          return <SlotRow key={s.key} slot={s} protocol={p} isFuture={isFuture} onLog={onLogSlot} onSkip={onSkipSlot} />;
        })}
        {info.extras.map((d) => (
          <DoseRow key={d.id} dose={d} protocol={d.protocolId ? (protocols.get(d.protocolId) ?? null) : null} slot={null} onPress={onOpenDose} />
        ))}
      </View>
      {!hasDoses ? (
        <TText variant="body" color="soft">
          {offCycle.length > 0 ? `Off-cycle day for ${offCycle.join(", ")}. Nothing due.` : "Nothing scheduled."}
        </TText>
      ) : offCycle.length > 0 ? (
        <TText variant="meta" color="soft">{`Off-cycle: ${offCycle.join(", ")}`}</TText>
      ) : null}

      {!isFuture ? <CheckInRow checkin={checkin} weightUnit={weightUnit} onPress={onCheckIn} /> : null}
      {!isFuture ? <PressButton label={isToday ? "Log another dose" : "Add a dose for this day"} icon="add" tone="ghost" size="sm" onPress={onAddDose} style={styles.add} /> : null}
    </Card>
  );
}

function Row({ icon, children, onPress, label, hint, trailing, hasBorder = true }: { icon: ReactNode; children: ReactNode; onPress?: () => void; label: string; hint?: string; trailing?: ReactNode; hasBorder?: boolean }) {
  const th = useTrackerTheme();
  const line = hasBorder ? { borderBottomColor: th.line } : styles.noBorder;
  const body = (
    <>
      {icon}
      <View style={styles.text}>{children}</View>
      {trailing}
    </>
  );
  if (!onPress) {
    return (
      <View style={[styles.row, line]} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [styles.row, line, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

function Badge({ icon, bg, fg, ring }: { icon: IconName | null; bg: string; fg: string; ring?: string }) {
  return <View style={[styles.badge, { backgroundColor: bg }, ring ? { borderWidth: 2, borderColor: ring } : null]}>{icon ? <Ionicons name={icon} size={14} color={fg} /> : null}</View>;
}

function DoseRow({ dose, protocol, slot, onPress }: { dose: DoseLog; protocol: Protocol | null; slot: Slot | null; onPress: (d: DoseLog) => void }) {
  const th = useTrackerTheme();
  const name = protocol?.name ?? dose.name;
  const time = clock(new Date(dose.takenAt));
  const timing = slot?.timing === "late" ? "Late" : slot?.timing === "early" ? "Early" : null;
  const meta = [formatDose(dose.dose), time, dose.site ? siteLabel(dose.site) : null].filter(Boolean).join(" · ");
  return (
    <Row
      icon={<Badge icon="checkmark" bg={th.status.done.solid} fg={th.status.done.soft} />}
      label={`${name}, ${formatDose(dose.dose)} taken at ${time}${dose.site ? `, ${siteLabel(dose.site)}` : ""}${timing ? `, ${timing.toLowerCase()}` : ""}`}
      hint="Edit this dose"
      onPress={() => onPress(dose)}
      trailing={<Ionicons name="chevron-forward" size={16} color={th.inkFaint} />}
    >
      <View style={styles.titleRow}>
        {protocol ? <View style={[styles.colorDot, { backgroundColor: protocol.color }]} /> : null}
        <TText variant="bodyStrong" numberOfLines={1} style={styles.flexShrink}>
          {name}
        </TText>
        {timing ? <Pill label={timing} /> : null}
      </View>
      <TText variant="meta" color="soft" tabular numberOfLines={2}>
        {meta}
      </TText>
      {dose.note ? (
        <TText variant="meta" color="faint" numberOfLines={2}>
          {`“${dose.note}”`}
        </TText>
      ) : null}
    </Row>
  );
}

function SkipRow({ slot, protocol, onPress }: { slot: Slot; protocol: Protocol | null; onPress: (s: Slot) => void }) {
  const th = useTrackerTheme();
  const name = protocol?.name ?? "Dose";
  const reason = slot.skip ? SKIP_REASON_LABEL[slot.skip.reason] : "";
  return (
    <Row
      icon={<Badge icon="play-skip-forward" bg={th.status.skipped.soft} fg={th.status.skipped.text} />}
      label={`${name}, ${formatTime(slot.time)}, skipped: ${reason}`}
      hint="Undo the skip"
      onPress={() => onPress(slot)}
      trailing={<TText variant="meta" color="brand">Undo</TText>}
    >
      <TText variant="bodyStrong" numberOfLines={1}>
        {name}
      </TText>
      <TText variant="meta" color="soft" tabular>{`Skipped · ${reason} · ${formatTime(slot.time)}`}</TText>
      {slot.skip?.note ? (
        <TText variant="meta" color="faint" numberOfLines={2}>
          {`“${slot.skip.note}”`}
        </TText>
      ) : null}
    </Row>
  );
}

function SlotRow({ slot, protocol, isFuture, onLog, onSkip }: { slot: Slot; protocol: Protocol | null; isFuture: boolean; onLog: (s: Slot) => void; onSkip: (s: Slot) => void }) {
  const th = useTrackerTheme();
  const name = protocol?.name ?? "Dose";
  const dose = protocol ? formatDose(protocol.dose) : "";
  const isMissed = slot.state === "missed";
  const word = isMissed ? "Missed" : isFuture ? "Planned" : "Due";
  const icon = isMissed ? (
    <Badge icon="close" bg={th.status.missed.soft} fg={th.status.missed.solid} />
  ) : (
    <Badge icon={null} bg="transparent" fg={th.ink} ring={isFuture ? th.line : th.brand} />
  );
  return (
    <View style={[styles.slot, { borderBottomColor: th.line }]}>
      <Row icon={icon} hasBorder={false} label={`${name}, ${dose}, ${word.toLowerCase()} at ${formatTime(slot.time)}`}>
        <TText variant="bodyStrong" numberOfLines={1}>
          {name}
        </TText>
        <TText variant="meta" color={isMissed ? th.status.missed.text : "soft"} tabular>
          {`${word} · ${formatTime(slot.time)}${dose ? ` · ${dose}` : ""}`}
        </TText>
      </Row>
      {!isFuture ? (
        <View style={styles.actions}>
          <PressButton label="Skip" size="sm" tone="ghost" accessibilityLabel={`Skip ${name} at ${formatTime(slot.time)}`} onPress={() => onSkip(slot)} />
          <PressButton
            label={isMissed ? "Log late" : "Log"}
            icon={isMissed ? "time-outline" : "checkmark"}
            size="sm"
            tone={isMissed ? "secondary" : "primary"}
            accessibilityLabel={`${isMissed ? "Log late" : "Log"}: ${name} at ${formatTime(slot.time)}`}
            accessibilityHint={isMissed ? "Opens the log sheet set to the time it was due" : undefined}
            onPress={() => onLog(slot)}
          />
        </View>
      ) : null}
    </View>
  );
}

function CheckInRow({ checkin, weightUnit, onPress }: { checkin: CheckIn | null; weightUnit: WeightUnit; onPress: () => void }) {
  const th = useTrackerTheme();
  if (!checkin) {
    return (
      <Row icon={<Badge icon="add" bg={th.brandSoft} fg={th.brandText} />} label="No check-in for this day. Add one" onPress={onPress}>
        <TText variant="bodyStrong" color="brand">
          Add a check-in
        </TText>
        <TText variant="meta" color="soft">
          Energy, side effects (or none), weight
        </TText>
      </Row>
    );
  }
  const summary = checkInSummary(checkin, weightUnit);
  return (
    <Row
      icon={<Badge icon="happy-outline" bg={th.brandSoft} fg={th.brandText} />}
      label={`Check-in: ${summary}`}
      hint="Edit this check-in"
      onPress={onPress}
      trailing={<Ionicons name="chevron-forward" size={16} color={th.inkFaint} />}
    >
      <TText variant="bodyStrong">Check-in</TText>
      <TText variant="meta" color="soft" tabular numberOfLines={3}>
        {summary}
      </TText>
      {checkin.note ? (
        <TText variant="meta" color="faint" numberOfLines={2}>
          {`“${checkin.note}”`}
        </TText>
      ) : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: 60, paddingVertical: TSPACE.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  slot: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: TSPACE.sm },
  noBorder: { borderBottomWidth: 0 },
  pressed: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flexShrink: { flexShrink: 1 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: TSPACE.sm, paddingLeft: 28 + TSPACE.md },
  add: { alignSelf: "flex-start", minHeight: TOUCH_MIN },
});
