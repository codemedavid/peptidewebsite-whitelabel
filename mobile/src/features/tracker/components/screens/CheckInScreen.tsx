/**
 * CHECK-IN (sheet, TRACKER.md §4 "Daily check-in"). ?date=YYYY-MM-DD, default
 * today — reached from CheckInNudge and the check-in reminder. Built for
 * speed: four 1–5 meters (tap again to clear), side-effect chips with a
 * prominent "No side effects today" that excludes the rest, weight in the
 * user's unit with the last weigh-in shown, a note, and one Save. Opening a
 * day that has a check-in edits it; it can be deleted.
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { deleteCheckIn, saveCheckIn, updateSettings, useTrackerState } from "../../hooks";
import { dayKey, formatDay, formatWeekdayDay, isDayKey } from "../../lib/ids";
import { SIDE_EFFECTS, type Scale, type WeightUnit } from "../../lib/types";
import { parseAmount } from "../../lib/dose-math";
import { formatWeight, toKg, toUnit } from "../../lib/weight";
import {
  formFrom,
  formToValues,
  hasAnswer,
  lastWeight,
  MAX_NOTE_LEN,
  MAX_OTHER_TEXT,
  NO_EFFECTS,
  SCALE_POINTS,
  SCALES,
  toggleEffect,
  type CheckInForm,
  type ScaleSpec,
} from "../checkin-model";
import { confirm, notify } from "../dialog";
import { NumberField, TextField } from "../fields";
import { Chip, ChipRow, haptic, PressButton, SectionHeader, SegmentedControl, TText } from "../kit";
import { trackerHref } from "../routes";
import { SheetScreen } from "../sheets";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast } from "../toast";

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

export function CheckInScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { isLoaded } = useTrackerState();
  const today = dayKey(new Date());
  // Never a future day: a check-in is about how you felt.
  const date = isDayKey(params.date) && params.date <= today ? params.date : today;
  if (!isLoaded) {
    return (
      <SheetScreen title="Check in" onClose={close}>
        <TText variant="body" color="soft">
          Opening your tracker…
        </TText>
      </SheetScreen>
    );
  }
  return <CheckInBody key={date} date={date} isToday={date === today} />;
}

function CheckInBody({ date, isToday }: { date: string; isToday: boolean }) {
  const th = useTrackerTheme();
  const { data } = useTrackerState();
  const unit = data.settings.weightUnit;
  const existing = data.checkins.find((c) => c.date === date) ?? null;
  const [start] = useState(() => formFrom(existing, unit));
  const [form, setForm] = useState<CheckInForm>(start);
  const [isOtherOpen, setIsOtherOpen] = useState(!!start.other);
  const patch = (next: Partial<CheckInForm>) => setForm((f) => ({ ...f, ...next }));
  const last = lastWeight(data.checkins, date);
  const noneOn = form.effects.includes(NO_EFFECTS);
  const canSave = hasAnswer(form);

  const switchUnit = (next: WeightUnit) => {
    if (next === unit) return;
    // Keep the shown weight the same body weight in the new unit.
    const value = parseAmount(form.weight);
    if (value !== null) patch({ weight: toUnit(toKg(value, unit), next).toFixed(1) });
    updateSettings({ weightUnit: next });
  };

  const save = () => {
    const result = formToValues(form, unit);
    if (!result.ok) {
      haptic("warning");
      notify("Check your weight", result.reason);
      return;
    }
    try {
      saveCheckIn({ date, ...result.values });
    } catch {
      notify("Couldn’t save", "This phone couldn’t save your check-in. Free up some space and try again.");
      return;
    }
    haptic("success");
    showTrackerToast({ message: existing ? "Check-in updated" : isToday ? "Checked in for today" : `Checked in for ${formatDay(date)}`, icon: "checkmark-circle" });
    close();
  };

  const leave = () => {
    if (JSON.stringify(form) === JSON.stringify(start)) return close();
    confirm("Discard this check-in?", "Nothing has been saved yet.", "Discard", close);
  };

  const remove = () => {
    if (!existing) return;
    confirm("Delete this check-in?", "Its scores, side effects and weight come off your history.", "Delete", () => {
      deleteCheckIn(existing.id);
      showTrackerToast({ message: "Check-in deleted", icon: "trash-outline" });
      close();
    });
  };

  return (
    <SheetScreen
      title={isToday ? "How are you today?" : "How were you?"}
      subtitle={`${formatWeekdayDay(date)}${existing ? " · editing" : ""} · every row is optional`}
      onClose={leave}
      closeLabel="Cancel"
      footer={<PressButton label={existing ? "Save changes" : "Save check-in"} icon="checkmark-circle" hapticKind="none" isDisabled={!canSave} onPress={save} accessibilityHint={canSave ? undefined : "Answer at least one row first"} />}
    >
      <View style={styles.group}>
        {SCALES.map((s) => (
          <ScaleRow key={s.key} spec={s} value={form.scales[s.key]} onChange={(v) => setForm((f) => ({ ...f, scales: { ...f.scales, [s.key]: v } }))} />
        ))}
      </View>

      <View style={styles.group}>
        <SectionHeader title="Side effects" />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="No side effects today"
          accessibilityState={{ checked: noneOn }}
          onPress={() => {
            haptic("select");
            const effects = toggleEffect(form.effects, NO_EFFECTS);
            if (effects.includes(NO_EFFECTS)) {
              setIsOtherOpen(false);
              patch({ effects, other: "" });
            } else patch({ effects });
          }}
          style={({ pressed }) => [
            styles.none,
            { backgroundColor: noneOn ? th.status.done.soft : th.surface, borderColor: noneOn ? th.status.done.solid : th.line },
            pressed ? styles.pressed : null,
          ]}
        >
          <Ionicons name={noneOn ? "checkmark-circle" : "ellipse-outline"} size={24} color={noneOn ? th.status.done.text : th.inkFaint} />
          <TText variant="bodyStrong" color={noneOn ? th.status.done.text : "ink"} style={styles.fill}>
            No side effects today
          </TText>
        </Pressable>
        <ChipRow label="Side effects">
          {SIDE_EFFECTS.map((e) => (
            <Chip key={e} label={e} role="checkbox" isSelected={form.effects.includes(e)} onPress={() => patch({ effects: toggleEffect(form.effects, e) })} />
          ))}
          <Chip
            label="Other"
            icon={isOtherOpen ? "remove" : "add"}
            role="checkbox"
            isSelected={isOtherOpen}
            onPress={() => {
              const opening = !isOtherOpen;
              setIsOtherOpen(opening);
              if (opening && noneOn) patch({ effects: toggleEffect(form.effects, NO_EFFECTS) });
              if (!opening) patch({ other: "" });
            }}
          />
        </ChipRow>
        {isOtherOpen ? (
          <TextField label="Other (comma between each)" value={form.other} onChangeText={(other) => patch({ other })} placeholder="e.g. Itchy site, hot flush" maxLength={MAX_OTHER_TEXT} autoFocus />
        ) : null}
      </View>

      <View style={styles.group}>
        <SectionHeader
          title="Weight"
          right={
            <SegmentedControl
              label="Weight unit"
              options={[
                { key: "kg", label: "kg" },
                { key: "lb", label: "lb" },
              ]}
              value={unit}
              onChange={switchUnit}
              style={styles.unitSwitch}
            />
          }
        />
        <NumberField
          label="Today’s weight (optional)"
          value={form.weight}
          onChangeText={(weight) => patch({ weight })}
          placeholder={last?.weightKg ? toUnit(last.weightKg, unit).toFixed(1) : "—"}
          maxLength={6}
          unit={unit}
          hint={last?.weightKg ? `Last: ${formatWeight(last.weightKg, unit)} · ${formatDay(last.date)}` : undefined}
        />
      </View>

      <TextField label="Note (optional)" value={form.note} onChangeText={(note) => patch({ note })} placeholder="Anything worth remembering…" multiline maxLength={MAX_NOTE_LEN} />

      <TText variant="meta" color="soft">
        Feeling unwell? Contact a clinician. In an emergency, call your local emergency number.
      </TText>

      {existing ? <PressButton label="Delete this check-in" icon="trash-outline" tone="danger" size="md" onPress={remove} /> : null}
    </SheetScreen>
  );
}

// ── 1–5 meter ────────────────────────────────────────────────────────────

/** Five numbered buttons; tapping one fills up to it like a meter (tap it again to clear). Each has its word. */
function ScaleRow({ spec, value, onChange }: { spec: ScaleSpec; value: Scale | null; onChange: (v: Scale | null) => void }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.scale}>
      <View style={styles.scaleHead}>
        <TText variant="headline" style={styles.fill}>
          {spec.label}
        </TText>
        <TText variant="meta" color={value ? "brand" : "faint"} accessibilityLiveRegion="polite">
          {value ? spec.words[value - 1] : "Tap to rate"}
        </TText>
      </View>
      <View style={styles.bars} accessibilityRole="radiogroup" accessibilityLabel={spec.label}>
        {SCALE_POINTS.map((n) => {
          const isOn = value !== null && n <= value;
          const isPicked = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={`${spec.label}: ${spec.words[n - 1]}, ${n} of 5`}
              accessibilityHint={isPicked ? "Tap again to clear" : undefined}
              accessibilityState={{ checked: isPicked }}
              onPress={() => {
                haptic("select");
                onChange(isPicked ? null : n);
              }}
              style={({ pressed }) => [
                styles.cell,
                {
                  // Up to the pick reads as a meter; the pick itself is solid.
                  backgroundColor: isPicked ? th.brand : isOn ? th.brandSoft : th.surface,
                  borderColor: isPicked ? th.brand : isOn ? th.brandSoft : th.line,
                },
                pressed ? styles.pressed : null,
              ]}
            >
              <TText variant="number" color={isPicked ? "onBrand" : isOn ? th.brandText : "soft"} tabular>
                {String(n)}
              </TText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ends} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <TText variant="meta" color="faint">
          {spec.words[0]}
        </TText>
        <TText variant="meta" color="faint">
          {spec.words[4]}
        </TText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
  group: { gap: TSPACE.md },
  none: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: 52, paddingHorizontal: TSPACE.lg, borderRadius: TRADIUS.md, borderWidth: 1.5 },
  scale: { gap: TSPACE.xs },
  scaleHead: { flexDirection: "row", alignItems: "baseline", gap: TSPACE.sm },
  bars: { flexDirection: "row", gap: TSPACE.sm },
  cell: { flex: 1, minHeight: TOUCH_MIN + 4, borderRadius: TRADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  unitSwitch: { width: 112 },
});
