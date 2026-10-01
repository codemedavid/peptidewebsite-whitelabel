import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ShopCheckoutConfig } from "@shop-contract";
import { SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { locationsFor, type CheckoutForm } from "../lib/checkout";
import { money } from "../lib/money";
import { ChoiceRow, FormSection, Notice } from "./ShopUI";

type Set = (patch: Partial<CheckoutForm>) => void;

export function ContactSection({ form, set }: { form: CheckoutForm; set: Set }) {
  return (
    <FormSection title="Contact" hint="So the store can reach you about this order.">
      <Field label="Full name" value={form.name} onChangeText={(name) => set({ name })} autoComplete="name" textContentType="name" returnKeyType="next" />
      <Field label="Email" value={form.email} onChangeText={(email) => set({ email })} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
      <Field label="Mobile number" value={form.phone} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" hint="Optional — leave blank to use the one on your account." />
    </FormSection>
  );
}

export function DeliverySection({
  form,
  set,
  onCourier,
  checkout,
  currency,
}: {
  form: CheckoutForm;
  set: Set;
  onCourier: (id: string) => void;
  checkout: ShopCheckoutConfig;
  currency: string;
}) {
  const courier = checkout.couriers.find((c) => c.id === form.courierId) ?? null;
  const locations = courier?.needsLocation ? locationsFor(checkout, courier.id) : [];
  return (
    <FormSection title="Delivery">
      {checkout.couriers.length > 0 ? (
        <View style={{ gap: SPACE.sm }}>
          <AppText variant="label" color="muted">Courier</AppText>
          <View accessibilityRole="radiogroup" style={{ gap: SPACE.sm }}>
            {checkout.couriers.map((c) => (
              <ChoiceRow
                key={c.id}
                selected={c.id === form.courierId}
                onPress={() => onCourier(c.id)}
                title={c.name}
                detail={c.needsLocation ? "Shipping fee depends on your area" : "Cash on delivery · pay the rider"}
                icon={c.needsLocation ? "cube-outline" : "bicycle-outline"}
              />
            ))}
          </View>
        </View>
      ) : null}
      {locations.length > 0 ? (
        <View style={{ gap: SPACE.sm }}>
          <AppText variant="label" color="muted">Ship to</AppText>
          <View accessibilityRole="radiogroup" style={{ gap: SPACE.sm }}>
            {locations.map((l) => (
              <ChoiceRow
                key={l.id}
                selected={l.id === form.locationId}
                onPress={() => set({ locationId: l.id })}
                title={l.name}
                trailing={<AppText variant="label" color="muted">{l.fee ? money(l.fee, currency) : "Free"}</AppText>}
              />
            ))}
          </View>
        </View>
      ) : courier?.needsLocation ? (
        <Notice tone="warning" icon="alert-circle">{`${courier.name} has no delivery areas set up. Choose another courier.`}</Notice>
      ) : null}
      <Field label="Street address" value={form.address} onChangeText={(address) => set({ address })} autoComplete="street-address" textContentType="fullStreetAddress" placeholder="House no., street, building" />
      <Field label="Barangay" value={form.barangay} onChangeText={(barangay) => set({ barangay })} />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <Field label="City" value={form.city} onChangeText={(city) => set({ city })} textContentType="addressCity" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Province" value={form.province} onChangeText={(province) => set({ province })} textContentType="addressState" />
        </View>
      </View>
      <Field label="Postal code" value={form.postal} onChangeText={(postal) => set({ postal })} keyboardType="number-pad" textContentType="postalCode" autoComplete="postal-code" />
    </FormSection>
  );
}

/** Type a code, apply it through the quote; the quote's error explains a bad one. */
export function PromoSection({ applied, error, onApply }: { applied: string; error: string | null; onApply: (code: string) => void }) {
  const [draft, setDraft] = useState(applied);
  const trimmed = draft.trim();
  return (
    <FormSection title="Promo code">
      <View style={styles.promo}>
        <View style={{ flex: 1 }}>
          <Field
            label="Code"
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => onApply(trimmed)}
            error={applied && error ? error : null}
          />
        </View>
        {applied && trimmed === applied ? (
          <Button label="Remove" variant="secondary" onPress={() => { setDraft(""); onApply(""); }} style={styles.promoBtn} />
        ) : (
          <Button label="Apply" variant="secondary" disabled={!trimmed} onPress={() => onApply(trimmed)} style={styles.promoBtn} />
        )}
      </View>
    </FormSection>
  );
}

export function NoteSection({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <FormSection title={label || "Note to the store"}>
      <Field label="Your note" value={value} onChangeText={onChange} multiline maxLength={500} placeholder="Anything the store should know?" />
    </FormSection>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: SPACE.md },
  promo: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  promoBtn: { paddingHorizontal: SPACE.lg },
});
