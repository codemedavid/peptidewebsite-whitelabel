import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import {
  MAX_STORE_CLOSED_HEADLINE,
  MAX_STORE_CLOSED_MESSAGE,
  brandName,
  normalizeStoreStatus,
  storeClosedNotice,
} from "@/features/admin/setup/rules";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText, Pill } from "@/ui/primitives";

/**
 * The website's Store Status (AdminStoreStatus → saveStoreStatusAction): the
 * open/closed switch plus the notice customers see while closed. Closing never
 * hides the shop — the catalog stays browsable and every buy button reads
 * "Closed" until the owner reopens.
 */
export default function StoreStatusScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Store status" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const [saved, setSaved] = useState(() => normalizeStoreStatus(brand.storeStatus));
  const [open, setOpen] = useState(saved.open);
  const [headline, setHeadline] = useState(saved.headline);
  const [message, setMessage] = useState(saved.message);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveStoreStatusAction");

  const draft = normalizeStoreStatus({ open, headline, message });
  const dirty = draft.open !== saved.open || draft.headline !== saved.headline || draft.message !== saved.message;
  useDiscardGuard(dirty);
  const name = brandName(brand);
  // The same builder the storefront banner uses, so the preview can't drift.
  const preview = storeClosedNotice(draft, name);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    hideSaved();
    set(v);
  };

  function onSave() {
    save.mutate(
      { open, headline, message },
      {
        onSuccess: () => {
          setSaved(draft);
          setHeadline(draft.headline);
          setMessage(draft.message);
          showSaved();
        },
        onError: (e) => Alert.alert("Couldn't save", e.message),
      },
    );
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <Section
        title={open ? "Your store is open" : "Your store is closed"}
        hint="Closing stops all orders without hiding your shop. Customers can still browse your products and see your prices — every “Add to Cart” button just reads Closed until you reopen."
      >
        <Pill
          tone={open ? "success" : "warning"}
          icon={open ? "storefront-outline" : "moon-outline"}
          label={open ? "Taking orders" : "Not taking orders"}
        />
        <ToggleRow
          label="Close my store — stop taking orders"
          hint="Leave this off for business as usual. Turning it on takes effect immediately, including for customers who already have items in their cart."
          value={!open}
          onChange={edit((closed: boolean) => setOpen(!closed))}
        />
      </Section>

      <Section title="What customers see">
        <Field
          label="Headline (optional)"
          value={headline}
          onChangeText={edit(setHeadline)}
          maxLength={MAX_STORE_CLOSED_HEADLINE}
          placeholder={`Hello — ${name || "your store"} is currently closed`}
          hint="Leave this blank and we'll greet your customers by your business name automatically."
        />
        <Field
          label="Your message"
          value={message}
          onChangeText={edit(setMessage)}
          maxLength={MAX_STORE_CLOSED_MESSAGE}
          multiline
          placeholder="We're restocking this week — back open Monday 9am. Thanks for your patience!"
          hint={`Tell customers why you're closed and when you'll be back. ${message.length}/${MAX_STORE_CLOSED_MESSAGE}`}
        />
      </Section>

      <Section
        title="Preview"
        hint={
          open
            ? "Nothing shows while your store is open — this is what customers would see if you closed it."
            : "This banner sits above your catalog on every page."
        }
      >
        <View style={[styles.notice, { backgroundColor: t.tone("warning").bg }]} accessible accessibilityLabel={`Preview: ${preview.headline}. ${preview.message}`}>
          <View style={[styles.badge, { backgroundColor: t.tone("warning").fg }]}>
            <AppText variant="caption" color={t.tone("warning").bg} style={{ fontWeight: "700" }}>
              Closed
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="bodyStrong" color={t.tone("warning").fg}>
              {preview.headline}
            </AppText>
            {preview.message ? (
              <AppText variant="caption" color={t.tone("warning").fg}>
                {preview.message}
              </AppText>
            ) : null}
          </View>
        </View>
        <Hint>{"The live banner uses your storefront's colours."}</Hint>
      </Section>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.lg, alignItems: "flex-start" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
});
