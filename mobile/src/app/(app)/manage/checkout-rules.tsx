import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import {
  CHECKOUT_RULE_CUSTOMER_NOTE_LABEL,
  CHECKOUT_RULE_DEFAULT_MESSAGES,
  CHECKOUT_RULE_MESSAGE_MAX,
  CHECKOUT_RULE_MIN_QTY_MAX,
  CHECKOUT_RULE_NOTICE_MAX,
  CUSTOMER_NOTE_LABEL_MAX,
  fillTokens,
  normalizeCheckoutRules,
  type CheckoutRuleMessages,
  type CheckoutRules,
} from "@/features/admin/rules/checkout";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";

const MESSAGE_FIELDS: readonly (readonly [keyof CheckoutRuleMessages, string])[] = [
  ["singleOrderType", "Single order type message"],
  ["mixedCart", "Mixed cart message"],
  ["minQuantity", "Minimum quantity message"],
  ["bacWater", "Bac water message"],
];

/**
 * The website's Smart Checkout (AdminCheckoutRules → saveCheckoutRulesAction):
 * cart restrictions, the rule-based checkout switch and its rules, and the copy
 * customers read. Operator-granted (showAdminCheckout); the server re-applies
 * the same gate and re-normalizes every save.
 */
export default function CheckoutRulesScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Smart checkout" }} />
      <Loadable query={brand}>
        {(b) =>
          b.showAdminCheckout === true ? (
            <Editor brand={b} />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="Smart Checkout isn't available"
              body="Your provider hasn't switched cart & checkout rules on for this store yet."
            />
          )
        }
      </Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<CheckoutRules>(() => normalizeCheckoutRules(brand.checkoutRules));
  const [rules, setRules] = useState<CheckoutRules>(saved);
  // Raw text so a cleared field doesn't snap back to 1 mid-edit; parsed on save.
  const [minText, setMinText] = useState(String(saved.minQuantity));
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveCheckoutRulesAction");

  const minNum = Number(minText);
  const minValid = /^\d+$/.test(minText.trim()) && minNum >= 1 && minNum <= CHECKOUT_RULE_MIN_QTY_MAX;
  const canSave = !rules.minQuantityEnabled || minValid;
  const value = normalizeCheckoutRules({ ...rules, minQuantity: minValid ? minNum : saved.minQuantity });
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  useDiscardGuard(dirty);

  const set = (edits: Partial<CheckoutRules>) => {
    hideSaved();
    setRules((r) => ({ ...r, ...edits }));
  };
  const setMessage = (key: keyof CheckoutRuleMessages, text: string) => {
    hideSaved();
    setRules((r) => ({ ...r, messages: { ...r.messages, [key]: text } }));
  };
  const toggle = (key: "singleOrderType" | "mixedCartPrevention" | "ruleBasedCheckout" | "minQuantityEnabled" | "adminFeeValidation" | "bacWaterValidation" | "customerNoteEnabled") => (v: boolean) =>
    set({ [key]: v } as Partial<CheckoutRules>);

  function onSave() {
    if (!canSave) return;
    save.mutate(value, {
      onSuccess: () => {
        setSaved(value);
        setRules(value);
        setMinText(String(value.minQuantity));
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const minSample = fillTokens(rules.messages.minQuantity.trim() || CHECKOUT_RULE_DEFAULT_MESSAGES.minQuantity, {
    min: value.minQuantity,
    count: Math.max(0, value.minQuantity - 1),
  });

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!canSave} onSave={onSave} />}>
      <Section
        title="Cart restrictions"
        hint="Hard limits on what a single cart may contain. These always apply — the rule-based checkout switch below doesn't soften them."
      >
        <ToggleRow
          label="Single order type per cart"
          hint="Reseller (wholesale-priced) and retail items can't be combined in one order — customers place them separately."
          value={rules.singleOrderType}
          onChange={toggle("singleOrderType")}
        />
        <ToggleRow
          label="Mixed cart prevention"
          hint="One product category per cart — adding an item from a second category is rejected with your message below."
          value={rules.mixedCartPrevention}
          onChange={toggle("mixedCartPrevention")}
        />
      </Section>

      <Section title="Checkout rules">
        <ToggleRow
          label="Rule-based checkout"
          hint="On: the rules below block checkout (and the server rejects violating orders). Off: they show as cart warnings only."
          value={rules.ruleBasedCheckout}
          onChange={toggle("ruleBasedCheckout")}
        />
        <ToggleRow
          label="Minimum quantity validation"
          hint="Require a minimum number of total items per order."
          value={rules.minQuantityEnabled}
          onChange={toggle("minQuantityEnabled")}
        />
        {rules.minQuantityEnabled ? (
          <View style={styles.narrow}>
            <Field
              label="Minimum items per order"
              value={minText}
              onChangeText={(v) => {
                hideSaved();
                setMinText(v.replace(/[^\d]/g, ""));
              }}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="1"
              error={minValid ? null : `Enter a whole number from 1 to ${CHECKOUT_RULE_MIN_QTY_MAX.toLocaleString()}.`}
            />
          </View>
        ) : null}
        <ToggleRow
          label="Admin fee validation"
          hint="Reject an order when the fee shown at checkout no longer matches the configured admin fee (it changed mid-session), so customers are never charged a total they didn't see."
          value={rules.adminFeeValidation}
          onChange={toggle("adminFeeValidation")}
        />
        <ToggleRow
          label="Bac water validation"
          hint="Peptide orders must include bacteriostatic water. Off by default — a peptide-only order is a normal order. Leave it off if you use Order Ratio Control to LIMIT bac water instead, or the two rules contradict each other."
          value={rules.bacWaterValidation}
          onChange={toggle("bacWaterValidation")}
        />
      </Section>

      <Section
        title="Checkout experience"
        hint="Customize what customers read. Leave a field blank to use the built-in message (shown as the placeholder). The minimum-quantity message supports {min} and {count}."
      >
        <Field
          label="Cart warning (always shown in the cart)"
          value={rules.cartWarning}
          onChangeText={(cartWarning) => set({ cartWarning })}
          maxLength={CHECKOUT_RULE_NOTICE_MAX}
          multiline
          placeholder="e.g. Peptide orders ship Mondays–Wednesdays only."
        />
        <Field
          label="Checkout notice (shown on the details step)"
          value={rules.checkoutNotice}
          onChangeText={(checkoutNotice) => set({ checkoutNotice })}
          maxLength={CHECKOUT_RULE_NOTICE_MAX}
          multiline
          placeholder="e.g. Double-check your shipping address — peptides are temperature-sensitive."
        />
        <ToggleRow
          label="Customer note box"
          hint="Lets the buyer add a request at checkout — a delivery window, a gate code, packaging preferences. Always optional; it never blocks an order. You'll see it on the order and in your export."
          value={rules.customerNoteEnabled}
          onChange={toggle("customerNoteEnabled")}
        />
        {rules.customerNoteEnabled ? (
          <Field
            label="Note box label"
            value={rules.customerNoteLabel}
            onChangeText={(customerNoteLabel) => set({ customerNoteLabel })}
            maxLength={CUSTOMER_NOTE_LABEL_MAX}
            placeholder={CHECKOUT_RULE_CUSTOMER_NOTE_LABEL}
          />
        ) : null}
      </Section>

      <Section title="Validation messages">
        {MESSAGE_FIELDS.map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={rules.messages[key]}
            onChangeText={(text) => setMessage(key, text)}
            maxLength={CHECKOUT_RULE_MESSAGE_MAX}
            multiline
            placeholder={CHECKOUT_RULE_DEFAULT_MESSAGES[key]}
            hint={key === "minQuantity" && rules.minQuantityEnabled ? `Customers see: “${minSample}”` : undefined}
          />
        ))}
        <Hint>
          {rules.ruleBasedCheckout
            ? "The minimum-quantity and bac water messages block checkout until the cart is fixed."
            : "Rule-based checkout is off — the minimum-quantity and bac water messages show as warnings and orders still go through. Cart restrictions always apply."}
        </Hint>
      </Section>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  narrow: { maxWidth: 260 },
});
