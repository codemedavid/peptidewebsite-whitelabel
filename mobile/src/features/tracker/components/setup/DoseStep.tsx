/**
 * Step 2 — "Your dose" (ported from MamaMicaGlow DoseStep). How it's taken,
 * the dose + unit (the field always starts EMPTY — the app never suggests a
 * dose), and for a vial the optional vial size + water so the vial counts
 * down. No syringe units / mL draw are shown (App Store 1.4.2; the converter
 * is a later feature behind `mobile.tracker.converter`). Typo guards are the
 * input checks from lib/dose-math (inputWarnings).
 */
import { StyleSheet, View } from "react-native";
import { DRAW_WARNING_TEXT, inputWarnings, unitLabel } from "../../lib/dose-math";
import { formDraw, unitsFor, type ProtocolForm, type RouteGroup } from "../../lib/protocol-form";
import type { DoseUnit, VialUnit } from "../../lib/types";
import { NumberField, ToggleRow } from "../fields";
import { Card, Chip, ChipRow, SectionHeader, SegmentedControl, TText } from "../kit";
import { TSPACE, useTrackerTheme } from "../theme";

const ROUTES: { key: RouteGroup; label: string }[] = [
  { key: "vial", label: "Vial" },
  { key: "pen", label: "Pen" },
  { key: "oral", label: "Oral" },
  { key: "other", label: "Other" },
];
const OTHER_ROUTES = [
  { key: "nasal", label: "Nasal" },
  { key: "topical", label: "Topical" },
  { key: "other", label: "Other" },
] as const;
const VIAL_UNITS: VialUnit[] = ["mg", "mcg", "iu"];

type Props = { form: ProtocolForm; onChange: (patch: Partial<ProtocolForm>) => void; showMix: boolean; onShowMix: (on: boolean) => void };

export function DoseStep({ form, onChange, showMix, onShowMix }: Props) {
  const th = useTrackerTheme();
  const units = unitsFor(form.routeGroup);
  const warnings = inputWarnings(formDraw(form));
  const isVial = form.routeGroup === "vial";

  const setRoute = (g: RouteGroup) => {
    const allowed = unitsFor(g);
    onChange({ routeGroup: g, doseUnit: allowed.includes(form.doseUnit) ? form.doseUnit : allowed[0] });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.block}>
        <SectionHeader title="How it’s taken" />
        <SegmentedControl label="How it's taken" options={ROUTES} value={form.routeGroup} onChange={setRoute} />
        {form.routeGroup === "other" ? (
          <ChipRow label="Route">
            {OTHER_ROUTES.map((r) => (
              <Chip key={r.key} label={r.label} isSelected={form.otherRoute === r.key} onPress={() => onChange({ otherRoute: r.key })} />
            ))}
          </ChipRow>
        ) : null}
      </View>

      <View style={styles.block}>
        <NumberField
          label="Your dose"
          isLarge
          value={form.doseValue}
          onChangeText={(t) => onChange({ doseValue: t })}
          placeholder="—"
          unit={unitLabel(form.doseUnit)}
          isInvalid={warnings.length > 0}
        />
        <ChipRow label="Dose unit">
          {units.map((u) => (
            <Chip key={u} label={unitLabel(u)} isSelected={form.doseUnit === u} onPress={() => onChange({ doseUnit: u as DoseUnit })} accessibilityLabel={`Dose in ${unitLabel(u)}`} />
          ))}
        </ChipRow>
        <TText variant="meta" color="soft">
          Enter the dose you and your clinician decided. This app never suggests doses.
        </TText>
      </View>

      {isVial ? (
        <View style={styles.block}>
          <ToggleRow label="Add vial details" hint="Vial size and water added, so the vial counts down as you log." value={showMix} onChange={onShowMix} />
          {showMix ? (
            <>
              <NumberField label="Vial contains" value={form.vialAmount} onChangeText={(t) => onChange({ vialAmount: t })} placeholder="—" unit={unitLabel(form.vialUnit)} />
              <ChipRow label="Vial unit">
                {VIAL_UNITS.map((u) => (
                  <Chip key={u} label={unitLabel(u)} isSelected={form.vialUnit === u} onPress={() => onChange({ vialUnit: u })} accessibilityLabel={`Vial in ${unitLabel(u)}`} />
                ))}
              </ChipRow>
              <NumberField label="Water added" value={form.waterMl} onChangeText={(t) => onChange({ waterMl: t })} placeholder="—" unit="mL" />
              {warnings.length > 0 ? (
                <Card tone="alt">
                  {warnings.map((w) => (
                    <TText key={w} variant="meta" color={th.status.low.text} accessibilityLiveRegion="polite">
                      {DRAW_WARNING_TEXT[w]}
                    </TText>
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.xl },
  block: { gap: TSPACE.md },
});
