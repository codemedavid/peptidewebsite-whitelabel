import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { SelectField } from "@/features/admin/catalog/components";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import {
  ChoicePills,
  FormPage,
  Hint,
  Loadable,
  SaveBar,
  Section,
  Stepper,
  ToggleRow,
  useDiscardGuard,
  useSavedFlash,
} from "@/features/admin/setup/ui";
import {
  DEFAULT_CAP_MESSAGE,
  DEFAULT_RATIO_MESSAGE,
  RATIO_MAX,
  RATIO_MESSAGE_MAX,
  isBacWaterProduct,
  normalizeGroupBuyRules,
  ratioSample,
  withDirection,
  type GroupBuyRatio,
  type GroupBuyRules,
  type RatioDirection,
  type RatioMode,
} from "@/features/admin/rules/checkout";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText } from "@/ui/primitives";

const DIRECTIONS: { key: RatioDirection; label: string; hint: string }[] = [
  {
    key: "floor",
    label: "Require bac water (floor)",
    hint: "Every peptide vial needs the ratio below in bacteriostatic water. A peptide-only cart is stopped until water is added.",
  },
  {
    key: "cap",
    label: "Limit bac water (cap)",
    hint: "Bacteriostatic water can't exceed the ratio below per peptide vial. Peptide-only orders are always allowed; water without a peptide is not.",
  },
];

/** Auto-add only tops a cart UP to a floor, so it isn't offered under a cap. */
const MODES: { key: RatioMode; label: string; hint: string; floorOnly?: boolean }[] = [
  { key: "strict", label: "Strict — block checkout", hint: "Customers can't check out until the cart complies." },
  {
    key: "auto_add",
    label: "Auto-add — keep the cart in sync",
    hint: "Adding a peptide automatically tops the cart up with the required bac water.",
    floorOnly: true,
  },
  { key: "warn", label: "Warn — allow checkout", hint: "Show a reminder when the rule is broken, but let the order through." },
];

/**
 * The website's Order Ratio Control (AdminGroupBuyRules → saveGroupBuyRulesAction):
 * ties bacteriostatic water to the peptides in a cart, as a floor (require) or a
 * cap (limit). Holds the FULL rules object so editing the ratio never clobbers
 * the engine's other settings. Gated on the Group Buy rules entitlement.
 */
export default function OrderRatioScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Order ratio control" }} />
      <Loadable query={brand}>
        {(b) =>
          b.showAdminGroupBuy === true ? (
            <Editor brand={b} />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="Order Ratio Control isn't available"
              body="Your provider hasn't switched Group Buy rules on for this store yet."
            />
          )
        }
      </Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const [saved, setSaved] = useState<GroupBuyRules>(() => normalizeGroupBuyRules(brand.groupBuyRules));
  const [rules, setRules] = useState<GroupBuyRules>(saved);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveGroupBuyRulesAction");
  const products = useCatalogProducts(brand);

  const ratio = rules.ratio;
  const isCap = ratio.direction === "cap";
  const value = normalizeGroupBuyRules(rules);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useDiscardGuard(dirty);

  const update = (next: (r: GroupBuyRules) => GroupBuyRules) => {
    hideSaved();
    setRules(next);
  };
  const patchRatio = (patch: Partial<GroupBuyRatio>) => update((r) => ({ ...r, ratio: { ...r.ratio, ...patch } }));

  // Bac-water-tagged (or named) products; every product when none are, so an
  // untagged catalog can still pick one — as the website does.
  const bacWaterOptions = useMemo(() => {
    const all = products.data ?? [];
    const tagged = all.filter(isBacWaterProduct);
    return [{ value: "", label: "— Select a product —" }, ...(tagged.length > 0 ? tagged : all).map((p) => ({ value: p.id, label: p.name }))];
  }, [products.data]);

  const autoAddNeedsProduct = ratio.enabled && !isCap && ratio.mode === "auto_add" && !ratio.defaultBacWaterProductId;
  const sample = ratioSample(value.ratio);

  function onSave() {
    if (autoAddNeedsProduct) {
      Alert.alert("Pick a product", "Pick a default bacteriostatic water product for auto-add.");
      return;
    }
    save.mutate(value, {
      onSuccess: () => {
        setSaved(value);
        setRules(value);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const modeOptions = MODES.filter((m) => !isCap || !m.floorOnly).map((m) => ({ key: m.key, label: m.label, hint: m.hint }));
  const dim = rules.enabled ? null : styles.dim;

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={autoAddNeedsProduct} onSave={onSave} />}>
      <Section
        title="Engine"
        hint="Tie bacteriostatic water to the peptides in the cart — either requiring it or limiting it. Classify each product as peptide or bac water in the product editor; this rule counts the cart by those tags."
      >
        <ToggleRow
          label="Enable Group Buy rules"
          hint="Master switch. Off keeps every rule below dormant."
          value={rules.enabled}
          onChange={(enabled) => update((r) => ({ ...r, enabled }))}
        />
      </Section>

      <View style={dim}>
        <Section title="Peptide ↔ bacteriostatic water ratio">
          <ToggleRow
            label={isCap ? "Limit bac water per peptide" : "Require bac water per peptide"}
            hint={DIRECTIONS.find((d) => d.key === ratio.direction)?.hint}
            value={ratio.enabled}
            onChange={(enabled) => patchRatio({ enabled })}
          />
          {ratio.enabled ? (
            <>
              <ChoicePills
                label="Direction"
                options={DIRECTIONS.map((d) => ({ key: d.key, label: d.label }))}
                value={ratio.direction}
                onChange={(direction) => update((r) => ({ ...r, ratio: withDirection(r.ratio, direction) }))}
              />
              <Stepper
                label={isCap ? "Max bac water per peptide vial" : "Bac water per peptide vial"}
                value={ratio.bacWaterPerPeptide}
                display={`${ratio.bacWaterPerPeptide} : 1`}
                min={1}
                max={RATIO_MAX}
                step={1}
                onChange={(bacWaterPerPeptide) => patchRatio({ bacWaterPerPeptide })}
              />
              <Hint>
                {isCap
                  ? "1 = at most one bac water per peptide vial (default). Set 2 to allow two, and so on."
                  : "1 = a 1:1 ratio (default). Set 2 for 2:1, 3 for 3:1, and so on."}
              </Hint>
              <ChoicePills label="Enforcement mode" options={modeOptions} value={ratio.mode} onChange={(mode) => patchRatio({ mode })} />
              {!isCap && ratio.mode === "auto_add" ? (
                <SelectField
                  label="Default bacteriostatic water product"
                  hint={
                    products.isError
                      ? "Couldn't load your products — pull back and try again."
                      : "Auto-add tops the cart up with this product. Required for auto-add mode."
                  }
                  value={ratio.defaultBacWaterProductId ?? ""}
                  options={bacWaterOptions}
                  placeholder={products.isPending ? "Loading products…" : "— Select a product —"}
                  onChange={(id) => patchRatio({ defaultBacWaterProductId: id || null })}
                />
              ) : null}
              {autoAddNeedsProduct ? <Hint tone="danger">Pick a default bacteriostatic water product for auto-add.</Hint> : null}
              <Field
                label="Custom message (optional)"
                value={ratio.message}
                onChangeText={(message) => patchRatio({ message })}
                maxLength={RATIO_MESSAGE_MAX}
                multiline
                placeholder={isCap ? DEFAULT_CAP_MESSAGE : DEFAULT_RATIO_MESSAGE}
                hint={
                  isCap
                    ? "Tokens: {ratio}, {peptide}, {allowed}, {bacWater}, {surplus}. Blank uses the default copy."
                    : "Tokens: {ratio}, {shortfall}, {required}, {peptide}. Blank uses the default copy."
                }
              />
              <View style={[styles.sample, { backgroundColor: t.tone(ratio.mode === "warn" ? "warning" : "danger").bg }]}>
                <AppText variant="overline" color={t.tone(ratio.mode === "warn" ? "warning" : "danger").fg}>
                  {`EXAMPLE · ${sample.cart.toUpperCase()}`}
                </AppText>
                <AppText variant="caption" color={t.tone(ratio.mode === "warn" ? "warning" : "danger").fg}>
                  {sample.message}
                </AppText>
              </View>
            </>
          ) : null}
        </Section>
      </View>

      <View style={dim}>
        <Section title="Where it applies">
          <ToggleRow
            label="Validate in the cart"
            hint="Show the ratio message in the cart drawer as the customer shops."
            value={rules.validation.cart}
            onChange={(cart) => update((r) => ({ ...r, validation: { ...r.validation, cart } }))}
          />
          <ToggleRow
            label="Validate at checkout"
            hint="Re-check on the server at order placement (recommended — can't be bypassed)."
            value={rules.validation.checkout}
            onChange={(checkout) => update((r) => ({ ...r, validation: { ...r.validation, checkout } }))}
          />
        </Section>
      </View>
      {!rules.enabled ? <Hint>The engine is off, so none of these rules apply yet.</Hint> : null}
    </FormPage>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.55 },
  sample: { gap: 4, padding: SPACE.md, borderRadius: RADIUS.md },
});
