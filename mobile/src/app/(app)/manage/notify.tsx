import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { EMAIL_MAX, isValidEmail, normalizeOrderNotifications } from "@/features/admin/rules/content";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";

/**
 * The website's Order Notifications (AdminOrderNotifications →
 * saveOrderNotificationsAction): email the owner the moment an order comes in.
 * Automated-package feature (showAdminOrderNotify). This screen only captures
 * WHERE to send it — delivery runs through the store's PostHog Messaging.
 */
export default function NotifyScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Order notifications" }} />
      <Loadable query={brand}>
        {(b) =>
          b.showAdminOrderNotify === true ? (
            <Editor brand={b} />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="Order emails aren't on your plan"
              body="Order notification emails come with the Automated package. Ask your provider to switch them on."
            />
          )
        }
      </Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState(() => normalizeOrderNotifications(brand.orderNotifications));
  const [enabled, setEnabled] = useState(saved.enabled);
  const [email, setEmail] = useState(saved.email);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveOrderNotificationsAction");

  const emailValid = isValidEmail(email);
  // Enabling needs a reachable inbox, so an "on but unreachable" state is never
  // saved; turning alerts off can always be saved.
  const canSave = !enabled || emailValid;
  const value = { enabled, email: email.trim() };
  const dirty = value.enabled !== saved.enabled || value.email !== saved.email.trim();
  useDiscardGuard(dirty);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    hideSaved();
    set(v);
  };

  function onSave() {
    if (!canSave) return;
    save.mutate(value, {
      onSuccess: () => {
        setSaved(value);
        setEmail(value.email);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const emailError = !enabled || emailValid ? null : email.trim() ? "That doesn't look like a valid email address." : "Enter the inbox that should get order alerts.";

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!canSave} onSave={onSave} />}>
      <Section
        title="Email me on new orders"
        hint="Get an email the moment a customer places an order, so you never miss one. The email carries the order number, total and who ordered."
      >
        <ToggleRow
          label="Email me when I receive an order"
          hint="When on, every new order sends one email to the address below. Existing orders are never re-sent."
          value={enabled}
          onChange={edit(setEnabled)}
        />
        {enabled ? (
          <Field
            label="Send alerts to"
            value={email}
            onChangeText={edit(setEmail)}
            maxLength={EMAIL_MAX}
            placeholder="you@gmail.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            error={emailError}
            hint="Any inbox works — your Gmail, a shared team address, etc."
          />
        ) : null}
      </Section>

      <Hint>
        {"Alerts are delivered through your store's connected analytics (PostHog Messaging). If you've just enabled this and aren't receiving emails, ask your provider to confirm PostHog is connected."}
      </Hint>
    </FormPage>
  );
}
