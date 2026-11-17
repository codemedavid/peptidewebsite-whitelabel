/**
 * Step 3 — "When" (ported from MamaMicaGlow ScheduleStep): the pattern (daily /
 * every other day / chosen weekdays / every N days / as needed), 1–3 times a
 * day in 5-minute steps, an optional on/off cycle, start and end dates, the
 * optional half-life for the estimated level chart, and site rotation.
 */
import { StyleSheet, View } from "react-native";
import { WEEKDAY_SHORT } from "../../lib/ids";
import { MAX_EVERY, MAX_TIMES, MIN_EVERY, type CycleKey, type ProtocolForm, type ScheduleKind } from "../../lib/protocol-form";
import { WEEKDAY_PRESETS } from "../../lib/schedule";
import { DateField, NumberField, TimeField, ToggleRow } from "../fields";
import { Chip, ChipRow, IconButton, PressButton, SectionHeader, Stepper, TText } from "../kit";
import { TSPACE } from "../theme";

const KINDS: { key: ScheduleKind; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "everyOther", label: "Every other day" },
  { key: "weekdays", label: "Chosen days" },
  { key: "interval", label: "Every few days" },
  { key: "asNeeded", label: "As needed" },
];
const CYCLES: { key: CycleKey; label: string }[] = [
  { key: "off", label: "No cycle" },
  { key: "5-2", label: "5 on / 2 off" },
  { key: "8w-4w", label: "8 wk on / 4 off" },
  { key: "custom", label: "Custom" },
];
/** Sensible second / third reminder times when adding one (user-editable). */
const EXTRA_TIMES = ["20:00", "14:00"];
const MAX_CYCLE_DIGITS = 3;

type Props = { form: ProtocolForm; onChange: (patch: Partial<ProtocolForm>) => void; isInjected: boolean };

export function ScheduleStep({ form, onChange, isInjected }: Props) {
  const isAsNeeded = form.scheduleKind === "asNeeded";
  const toggleDay = (d: number) => onChange({ days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] });
  const setTime = (i: number, t: string) => onChange({ times: form.times.map((x, j) => (j === i ? t : x)) });
  const digits = (t: string) => t.replace(/\D/g, "").slice(0, MAX_CYCLE_DIGITS);

  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <SectionHeader title="How often" />
        <ChipRow label="How often">
          {KINDS.map((k) => (
            <Chip key={k.key} label={k.label} isSelected={form.scheduleKind === k.key} onPress={() => onChange({ scheduleKind: k.key })} />
          ))}
        </ChipRow>
        {form.scheduleKind === "interval" ? (
          <Stepper label="Days between doses" value={form.everyDays} min={MIN_EVERY} max={MAX_EVERY} onChange={(n) => onChange({ everyDays: n })} format={(n) => `Every ${n} days`} />
        ) : null}
        {form.scheduleKind === "weekdays" ? (
          <>
            <ChipRow label="Days">
              {WEEKDAY_SHORT.map((label, d) => (
                <Chip key={label} label={label} role="checkbox" isSelected={form.days.includes(d)} onPress={() => toggleDay(d)} />
              ))}
            </ChipRow>
            <ChipRow label="Quick picks">
              {WEEKDAY_PRESETS.map((p) => (
                <Chip key={p.key} label={p.label} role="button" isSelected={false} onPress={() => onChange({ days: p.days })} />
              ))}
            </ChipRow>
          </>
        ) : null}
        {isAsNeeded ? (
          <TText variant="meta" color="soft">
            No schedule or reminders. Log it whenever you take it.
          </TText>
        ) : null}
      </View>

      {!isAsNeeded ? (
        <View style={styles.block}>
          <SectionHeader title={`Times a day · ${form.times.length}`} />
          {form.times.map((t, i) => (
            <View key={i} style={styles.timeRow}>
              <View style={styles.fill}>
                <TimeField label={`Dose time ${i + 1}`} value={t} onChange={(v) => setTime(i, v)} />
              </View>
              {form.times.length > 1 ? (
                <IconButton icon="trash-outline" label={`Remove dose time ${i + 1}`} tone="plain" onPress={() => onChange({ times: form.times.filter((_, j) => j !== i) })} />
              ) : null}
            </View>
          ))}
          {form.times.length < MAX_TIMES ? (
            <PressButton
              label="Add a time"
              icon="add"
              tone="soft"
              size="sm"
              onPress={() => onChange({ times: [...form.times, EXTRA_TIMES[form.times.length - 1] ?? "12:00"] })}
            />
          ) : null}
        </View>
      ) : null}

      {!isAsNeeded ? (
        <View style={styles.block}>
          <SectionHeader title="On / off cycle" right={<TText variant="meta" color="faint">Optional</TText>} />
          <ChipRow label="Cycle">
            {CYCLES.map((c) => (
              <Chip key={c.key} label={c.label} isSelected={form.cycleKey === c.key} onPress={() => onChange({ cycleKey: c.key })} />
            ))}
          </ChipRow>
          {form.cycleKey === "custom" ? (
            <>
              <ChipRow label="Cycle counted in">
                <Chip label="Days" isSelected={!form.cycleInWeeks} onPress={() => onChange({ cycleInWeeks: false })} />
                <Chip label="Weeks" isSelected={form.cycleInWeeks} onPress={() => onChange({ cycleInWeeks: true })} />
              </ChipRow>
              <View style={styles.pair}>
                <View style={styles.fill}>
                  <NumberField label={form.cycleInWeeks ? "Weeks on" : "Days on"} value={form.cycleOn} onChangeText={(t) => onChange({ cycleOn: digits(t) })} keyboardType="number-pad" inputMode="numeric" />
                </View>
                <View style={styles.fill}>
                  <NumberField label={form.cycleInWeeks ? "Weeks off" : "Days off"} value={form.cycleOff} onChangeText={(t) => onChange({ cycleOff: digits(t) })} keyboardType="number-pad" inputMode="numeric" />
                </View>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionHeader title="Starts" />
        <DateField label="Start date" value={form.startDate} onChange={(d) => onChange({ startDate: d, endDate: form.endDate && form.endDate < d ? d : form.endDate })} />
        <SectionHeader title="Ends" />
        {form.endDate ? (
          <View style={styles.timeRow}>
            <View style={styles.fill}>
              <DateField label="End date" value={form.endDate} min={form.startDate} onChange={(d) => onChange({ endDate: d })} />
            </View>
            <IconButton icon="close" label="No end date" tone="plain" onPress={() => onChange({ endDate: null })} />
          </View>
        ) : (
          <PressButton label="No end date · add one" icon="calendar-outline" tone="secondary" size="sm" onPress={() => onChange({ endDate: form.startDate })} />
        )}
      </View>

      <View style={styles.block}>
        <NumberField
          label="Half-life in hours (optional)"
          value={form.halfLifeHours}
          onChangeText={(t) => onChange({ halfLifeHours: t })}
          placeholder="—"
          unit="h"
          hint="Optional. Used only for the estimated level chart in Progress. Leave blank if you’re not sure."
        />
        {isInjected ? <ToggleRow label="Rotate injection sites" hint="Suggests the next site each time. You can always pick another." value={form.rotateSites} onChange={(v) => onChange({ rotateSites: v })} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.xl },
  block: { gap: TSPACE.md },
  fill: { flex: 1 },
  timeRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  pair: { flexDirection: "row", gap: TSPACE.md },
});
