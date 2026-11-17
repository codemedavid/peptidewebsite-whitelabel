/**
 * Form fields for tracker screens. No native picker package is bundled, so
 * time and date are built here — which suits the research anyway: times move
 * in 5-minute steps (never a minute-by-minute wheel) and default to "now".
 *
 *   NumberField  label + big decimal box + unit
 *   TextField    label + text box (notes, names)
 *   ToggleRow    label + hint + switch
 *   TimeField    − 8:05 PM + (5-min steps); tap → hour / minute grid sheet
 *   DateField    ‹ Mon, 17 Nov ›; tap → month grid sheet (min / max honoured)
 */
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { addDays, dayKey, formatTime, formatWeekdayDay, isTimeKey, MONTH_LONG, parseDayKey, timeMinutes, WEEKDAY_LETTERS, weekStart } from "../lib/ids";
import { Chip, haptic, IconButton, PressButton, SegmentedControl, TText } from "./kit";
import { BottomSheet } from "./sheets";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "./theme";

// ── NumberField / TextField ───────────────────────────────────────────────

type NumberFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  /** Shown after the box ("mcg", "mL"). */
  unit?: ReactNode;
  hint?: string;
  isInvalid?: boolean;
  /** The big centred style used for the dose on the log screen. */
  isLarge?: boolean;
};

export function NumberField({ label, unit, hint, isInvalid, isLarge, ...input }: NumberFieldProps) {
  const th = useTrackerTheme();
  return (
    <View style={styles.field}>
      <TText variant="meta" color="soft">
        {label}
      </TText>
      <View style={[styles.numberRow, isLarge ? styles.numberRowLarge : null, { backgroundColor: th.surface, borderColor: isInvalid ? th.status.missed.solid : th.line }]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholderTextColor={th.inkFaint}
          selectionColor={th.brand}
          keyboardAppearance={th.scheme}
          maxFontSizeMultiplier={1.4}
          style={[isLarge ? th.type.hero : th.type.number, styles.numberInput, { color: th.ink }]}
          {...input}
        />
        {typeof unit === "string" ? (
          <TText variant={isLarge ? "title" : "bodyStrong"} color="soft">
            {unit}
          </TText>
        ) : (
          unit
        )}
      </View>
      {hint ? (
        <TText variant="meta" color={isInvalid ? th.status.missed.text : "faint"}>
          {hint}
        </TText>
      ) : null}
    </View>
  );
}

export function TextField({ label, hint, ...input }: Omit<TextInputProps, "style"> & { label: string; hint?: string }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.field}>
      <TText variant="meta" color="soft">
        {label}
      </TText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={th.inkFaint}
        selectionColor={th.brand}
        keyboardAppearance={th.scheme}
        maxFontSizeMultiplier={1.6}
        style={[th.type.body, styles.textInput, { color: th.ink, backgroundColor: th.surface, borderColor: th.line }, input.multiline ? styles.multiline : null]}
        {...input}
      />
      {hint ? (
        <TText variant="meta" color="faint">
          {hint}
        </TText>
      ) : null}
    </View>
  );
}

// ── ToggleRow ─────────────────────────────────────────────────────────────

export function ToggleRow({ label, hint, value, onChange, isDisabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; isDisabled?: boolean }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.fill}>
        <TText variant="bodyStrong" color={isDisabled ? "faint" : "ink"}>
          {label}
        </TText>
        {hint ? (
          <TText variant="meta" color="soft">
            {hint}
          </TText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic("select");
          onChange(v);
        }}
        disabled={isDisabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ false: th.line, true: th.brand }}
        thumbColor={th.surface}
        ios_backgroundColor={th.line}
      />
    </View>
  );
}

// ── Time ──────────────────────────────────────────────────────────────────

export const TIME_STEP_MIN = 5;
const DAY_MIN = 24 * 60;
const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes after midnight → "HH:MM" (wraps around the day). */
export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Moves a time by ±5 minutes, snapping to the 5-minute grid first ("8:03" + → "8:05"). */
export function stepTime(time: string, direction: 1 | -1): string {
  const m = timeMinutes(time) ?? 0;
  const snapped = direction > 0 ? Math.floor(m / TIME_STEP_MIN) * TIME_STEP_MIN + TIME_STEP_MIN : Math.ceil(m / TIME_STEP_MIN) * TIME_STEP_MIN - TIME_STEP_MIN;
  return minutesToTime(snapped);
}

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 / TIME_STEP_MIN }, (_, i) => i * TIME_STEP_MIN);

type TimeFieldProps = {
  /** "HH:MM" */
  value: string;
  onChange: (time: string) => void;
  label: string;
};

export function TimeField({ value, onChange, label }: TimeFieldProps) {
  const th = useTrackerTheme();
  const [isOpen, setIsOpen] = useState(false);
  const safe = isTimeKey(value) ? value : "09:00";
  return (
    <View style={styles.stepRow}>
      <IconButton icon="remove" label={`${label}: 5 minutes earlier`} onPress={() => onChange(stepTime(safe, -1))} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatTime(safe)}`}
        accessibilityHint="Opens a time picker"
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [styles.valueBox, { backgroundColor: th.surface, borderColor: th.line }, pressed ? { opacity: 0.7 } : null]}
      >
        <TText variant="number" tabular numberOfLines={1}>
          {formatTime(safe)}
        </TText>
        <Ionicons name="chevron-down" size={14} color={th.inkFaint} />
      </Pressable>
      <IconButton icon="add" label={`${label}: 5 minutes later`} onPress={() => onChange(stepTime(safe, 1))} />
      <TimePickerSheet visible={isOpen} value={safe} label={label} onClose={() => setIsOpen(false)} onDone={(t) => onChange(t)} />
    </View>
  );
}

function TimePickerSheet({ visible, value, label, onClose, onDone }: { visible: boolean; value: string; label: string; onClose: () => void; onDone: (t: string) => void }) {
  const m = timeMinutes(value) ?? 0;
  const [hour24, setHour24] = useState(Math.floor(m / 60));
  const [minute, setMinute] = useState(Math.round((m % 60) / TIME_STEP_MIN) * TIME_STEP_MIN % 60);
  // Re-seed whenever it opens on a new value.
  const [seed, setSeed] = useState(value);
  if (visible && seed !== value) {
    setSeed(value);
    setHour24(Math.floor(m / 60));
    setMinute((Math.round((m % 60) / TIME_STEP_MIN) * TIME_STEP_MIN) % 60);
  }
  const isPm = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const setHour12 = (h: number) => setHour24((h % 12) + (isPm ? 12 : 0));
  const chosen = `${pad(hour24)}:${pad(minute)}`;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={label}
      subtitle={formatTime(chosen)}
      footer={
        <PressButton
          label={`Set ${formatTime(chosen)}`}
          onPress={() => {
            onDone(chosen);
            onClose();
          }}
        />
      }
    >
      <SegmentedControl
        label="Morning or afternoon"
        options={[
          { key: "am", label: "AM" },
          { key: "pm", label: "PM" },
        ]}
        value={isPm ? "pm" : "am"}
        onChange={(k) => setHour24((hour24 % 12) + (k === "pm" ? 12 : 0))}
      />
      <View style={styles.gridBlock}>
        <TText variant="micro" color="faint">
          Hour
        </TText>
        <View style={styles.grid}>
          {HOURS_12.map((h) => (
            <GridCell key={h} label={String(h)} spoken={`${h} o'clock`} isSelected={h === hour12} onPress={() => setHour12(h)} />
          ))}
        </View>
      </View>
      <View style={styles.gridBlock}>
        <TText variant="micro" color="faint">
          Minute
        </TText>
        <View style={styles.grid}>
          {MINUTES.map((mm) => (
            <GridCell key={mm} label={`:${pad(mm)}`} spoken={`${mm} minutes`} isSelected={mm === minute} onPress={() => setMinute(mm)} />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

function GridCell({ label, spoken, isSelected, onPress, isDisabled, isMarked, isCompact }: { label: string; spoken: string; isSelected: boolean; onPress: () => void; isDisabled?: boolean; isMarked?: boolean; isCompact?: boolean }) {
  const th = useTrackerTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={spoken}
      accessibilityState={{ checked: isSelected, disabled: !!isDisabled }}
      disabled={isDisabled}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [
        styles.cell,
        isCompact ? styles.cellCompact : null,
        { backgroundColor: isSelected ? th.brand : pressed ? th.surfaceAlt : "transparent", borderColor: isMarked && !isSelected ? th.brand : "transparent", opacity: isDisabled ? 0.3 : 1 },
      ]}
    >
      <TText variant="bodyStrong" tabular color={isSelected ? th.onBrand : th.ink}>
        {label}
      </TText>
    </Pressable>
  );
}

// ── Date ──────────────────────────────────────────────────────────────────

type DateFieldProps = {
  /** "YYYY-MM-DD" */
  value: string;
  onChange: (day: string) => void;
  label: string;
  min?: string;
  max?: string;
};

export function DateField({ value, onChange, label, min, max }: DateFieldProps) {
  const th = useTrackerTheme();
  const [isOpen, setIsOpen] = useState(false);
  const prev = addDays(value, -1);
  const next = addDays(value, 1);
  return (
    <View style={styles.stepRow}>
      <IconButton icon="chevron-back" label={`${label}: day before`} isDisabled={!!min && prev < min} onPress={() => onChange(prev)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatWeekdayDay(value)}`}
        accessibilityHint="Opens a calendar"
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [styles.valueBox, { backgroundColor: th.surface, borderColor: th.line }, pressed ? { opacity: 0.7 } : null]}
      >
        <TText variant="bodyStrong" numberOfLines={1}>
          {formatWeekdayDay(value)}
        </TText>
        <Ionicons name="calendar-outline" size={15} color={th.inkFaint} />
      </Pressable>
      <IconButton icon="chevron-forward" label={`${label}: day after`} isDisabled={!!max && next > max} onPress={() => onChange(next)} />
      <DatePickerSheet visible={isOpen} value={value} label={label} min={min} max={max} onClose={() => setIsOpen(false)} onPick={onChange} />
    </View>
  );
}

function monthKeyOf(day: string): string {
  return day.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function DatePickerSheet({ visible, value, label, min, max, onClose, onPick }: Omit<DateFieldProps, "onChange"> & { visible: boolean; onClose: () => void; onPick: (d: string) => void }) {
  const [month, setMonth] = useState(monthKeyOf(value));
  const [seed, setSeed] = useState(value);
  if (visible && seed !== value) {
    setSeed(value);
    setMonth(monthKeyOf(value));
  }
  const first = `${month}-01`;
  const start = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const [y, m] = month.split("-").map(Number);
  const today = dayKey(new Date());
  const canPrev = !min || shiftMonth(month, -1) >= monthKeyOf(min);
  const canNext = !max || shiftMonth(month, 1) <= monthKeyOf(max);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={label}>
      <View style={styles.monthHead}>
        <IconButton icon="chevron-back" label="Previous month" isDisabled={!canPrev} onPress={() => setMonth(shiftMonth(month, -1))} />
        <TText variant="headline" style={styles.monthTitle} accessibilityRole="header">
          {`${MONTH_LONG[m - 1]} ${y}`}
        </TText>
        <IconButton icon="chevron-forward" label="Next month" isDisabled={!canNext} onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>
      <View style={styles.weekRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAY_LETTERS.map((l, i) => (
          <TText key={i} variant="micro" color="faint" style={styles.weekLetter}>
            {l}
          </TText>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {days.map((d) => {
          const inMonth = monthKeyOf(d) === month;
          const isOut = (!!min && d < min) || (!!max && d > max);
          return (
            <View key={d} style={styles.monthCell}>
              {inMonth ? (
                <GridCell
                  label={String(parseDayKey(d).getDate())}
                  spoken={formatWeekdayDay(d)}
                  isSelected={d === value}
                  isMarked={d === today}
                  isDisabled={isOut}
                  isCompact
                  onPress={() => {
                    onPick(d);
                    onClose();
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      <Chip label="Today" role="button" isSelected={false} isDisabled={(!!min && today < min) || (!!max && today > max)} onPress={() => {
          onPick(today);
          onClose();
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  field: { gap: 6 },
  numberRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: 52, borderWidth: 1, borderRadius: TRADIUS.md, paddingHorizontal: TSPACE.md },
  numberRowLarge: { minHeight: 76, paddingHorizontal: TSPACE.lg },
  numberInput: { flex: 1, minWidth: 0, paddingVertical: TSPACE.sm, minHeight: TOUCH_MIN },
  textInput: { minHeight: 48, borderWidth: 1, borderRadius: TRADIUS.md, paddingHorizontal: TSPACE.md, paddingVertical: TSPACE.sm },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  toggle: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: 56 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  valueBox: {
    flex: 1,
    minHeight: TOUCH_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: TRADIUS.md,
    paddingHorizontal: TSPACE.md,
  },
  gridBlock: { gap: TSPACE.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: { minWidth: TOUCH_MIN + 8, minHeight: TOUCH_MIN, borderRadius: TRADIUS.sm, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  // A month cell is 1/7 of the sheet (≈ 41 pt at 320 pt wide): fill it, keep 44 pt tall.
  cellCompact: { minWidth: 0, width: "100%", paddingHorizontal: 0 },
  monthHead: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  monthTitle: { flex: 1, textAlign: "center" },
  weekRow: { flexDirection: "row" },
  weekLetter: { flex: 1, textAlign: "center" },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  monthCell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 2 },
});
