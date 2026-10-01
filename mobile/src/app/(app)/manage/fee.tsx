import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import {
  ADMIN_FEE_AMOUNT_MAX,
  ADMIN_FEE_LABEL_DEFAULT,
  ADMIN_FEE_LABEL_MAX,
  FEE_LABEL_PRESETS,
  currencyOf,
  isFeeLocked,
  normalizeAdminFee,
} from "@/features/admin/setup/rules";
import { ChoicePills, FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";

/**
 * The website's Checkout Fee (AdminFeeSettings → saveStoreAdminFeeAction): one
 * flat charge added to every new order, labelled however the owner likes.
 * Business-exclusive — locked during a trial or without the entitlement, the
 * same rule the website tile and the server save apply.
 */
export default function FeeScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Checkout fee" }} />
      <Loadable query={brand}>
        {(b) =>
          isFeeLocked(b) ? (
            <EmptyState
              icon="lock-closed-outline"
              title="Checkout Fee is a Business feature"
              body="Upgrade to Business to add a shipping, service or processing fee at checkout."
            />
          ) : (
            <Editor brand={b} />
          )
        }
      </Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  // Normalized once so a legacy or absent config becomes a clean shape to edit.
  const [initial, setInitial] = useState(() => normalizeAdminFee(brand.adminFee));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [label, setLabel] = useState(initial.label);
  // Raw text so a partial entry ("12.") doesn't fight the field; parsed on save.
  const [amount, setAmount] = useState(initial.amount > 0 ? String(initial.amount) : "");
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveStoreAdminFeeAction");

  const currency = currencyOf(brand);
  const amountNum = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0 && amountNum <= ADMIN_FEE_AMOUNT_MAX;
  const canSave = !enabled || amountValid;
  const previewLabel = label.trim() || ADMIN_FEE_LABEL_DEFAULT;

  // This view edits the flat fee only — the saved mode/percent ride through so a
  // percentage fee set by the operator isn't clobbered to fixed.
  const value = normalizeAdminFee({ enabled, label, amount: Number(amount) || 0, mode: initial.mode, percent: initial.percent });
  const dirty = value.enabled !== initial.enabled || value.label !== initial.label || value.amount !== initial.amount;
  useDiscardGuard(dirty);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    hideSaved();
    set(v);
  };

  function onSave() {
    if (!canSave) return;
    save.mutate(value, {
      onSuccess: () => {
        setInitial(value);
        setLabel(value.label);
        setAmount(value.amount > 0 ? String(value.amount) : "");
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const amountError = amountValid
    ? null
    : `Enter an amount above zero${amountNum > ADMIN_FEE_AMOUNT_MAX ? ` (max ${ADMIN_FEE_AMOUNT_MAX.toLocaleString()})` : ""}, or turn the fee off.`;

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!canSave} onSave={onSave} />}>
      <Section
        title="Checkout fee"
        hint="A single charge added on top of the order total at checkout — e.g. a shipping, service or processing fee. Customers see it as its own line in the totals. Use this if you'd rather charge one flat fee than set a fee on every shipping location."
      >
        <ToggleRow
          label="Charge a fee at checkout"
          hint="When on, the fee below is added once to every new order. Existing orders are never changed."
          value={enabled}
          onChange={edit(setEnabled)}
        />
      </Section>

      {enabled ? (
        <Section title="The fee">
          <Field
            label="What the fee is for"
            value={label}
            onChangeText={edit(setLabel)}
            maxLength={ADMIN_FEE_LABEL_MAX}
            placeholder={ADMIN_FEE_LABEL_DEFAULT}
            hint="The line label customers see in the totals, e.g. “Shipping fee” or “Service charge”."
          />
          <ChoicePills
            label="Quick labels"
            options={FEE_LABEL_PRESETS.map((p) => ({ key: p, label: p }))}
            value={FEE_LABEL_PRESETS.includes(label.trim()) ? label.trim() : ""}
            onChange={edit(setLabel)}
          />
          <View style={styles.amount}>
            <Field
              label={`Amount (${currency})`}
              value={amount}
              onChangeText={edit(setAmount)}
              keyboardType="decimal-pad"
              placeholder="0.00"
              error={amountError}
            />
          </View>
        </Section>
      ) : null}

      <Hint>
        {enabled && amountValid
          ? `Checkout will show “${previewLabel}: ${currency}${amountNum.toLocaleString()}” above the total.`
          : "No fee is charged at checkout."}
      </Hint>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  amount: { maxWidth: 260, gap: SPACE.sm },
});
