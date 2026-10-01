import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { useResellerSettings, useSaveReseller } from "@/features/admin/reseller/hooks";
import {
  DEFAULT_RESELLER_GATE_SUB,
  DEFAULT_RESELLER_GATE_TITLE,
  MIN_PASSWORD_LENGTH,
  type ResellerSettings,
} from "@/features/admin/reseller/model";
import { WholesaleList } from "@/features/admin/reseller/WholesaleList";
import { Field } from "@/ui/inputs";
import { Button, Pill } from "@/ui/primitives";
import { useOnline } from "@/ui/feedback";

/**
 * The website's Reseller Portal (AdminResellerSettings): the reseller page
 * password (stored as a one-way hash — set, replace or remove, never shown),
 * the wording of the password screen, and every product's wholesale price with
 * a jump to the product editor. Availability is the operator's entitlement.
 */
export default function ResellerScreen() {
  const brand = useAdminBrand();
  const settings = useResellerSettings();
  return (
    <>
      <Stack.Screen options={{ title: "Reseller portal" }} />
      <Loadable query={brand}>
        {(b) => <Loadable query={settings}>{(s) => <Editor brand={b} settings={s} />}</Loadable>}
      </Loadable>
    </>
  );
}

function Editor({ brand, settings }: { brand: AdminBrand; settings: ResellerSettings }) {
  const online = useOnline();
  const save = useSaveReseller();
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const [hasCode, setHasCode] = useState(settings.hasCode);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState({ title: settings.gateTitle, sub: settings.gateSub });
  const [gateTitle, setGateTitle] = useState(settings.gateTitle);
  const [gateSub, setGateSub] = useState(settings.gateSub);

  const trimmed = code.trim();
  const codeError = trimmed && trimmed.length < MIN_PASSWORD_LENGTH ? `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` : null;
  const dirty = !!trimmed || gateTitle !== saved.title || gateSub !== saved.sub;
  useDiscardGuard(dirty);

  const edit = (set: (v: string) => void) => (v: string) => {
    hideSaved();
    set(v);
  };

  const onSave = () => {
    save.mutate(
      // Omit `code` when the box is empty so saving the wording never touches the password.
      { ...(trimmed ? { code: trimmed } : {}), merchantGateTitle: gateTitle, merchantGateSub: gateSub },
      {
        onSuccess: () => {
          if (trimmed) {
            setHasCode(true);
            setCode("");
          }
          setSaved({ title: gateTitle, sub: gateSub });
          showSaved();
        },
        onError: (e) => Alert.alert("Couldn't save", e.message),
      },
    );
  };

  // Removing re-locks the page AND signs out every reseller (the code version bumps).
  const onRemove = () =>
    Alert.alert(
      "Remove the reseller password?",
      "The reseller page locks again and anyone currently signed in is signed out.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            save.mutate(
              { code: "", clear: true },
              {
                onSuccess: () => {
                  setHasCode(false);
                  setCode("");
                },
                onError: (e) => Alert.alert("Couldn't remove the password", e.message),
              },
            ),
        },
      ],
    );

  const status = !settings.available
    ? { tone: "danger" as const, text: "Your plan doesn't include the Reseller feature yet — contact your provider to enable it. You can still set a password below so it's ready the moment they do." }
    : !settings.pageAvailable
      ? {
          tone: "danger" as const,
          text: `The Reseller feature is on, but the Wholesale reseller page isn't enabled for your store yet — ask your provider to turn it on. Wholesale pricing on your regular storefront is ${
            settings.wholesaleAvailable ? "already active" : "also off"
          }.`,
        }
      : hasCode
        ? { tone: "success" as const, text: "Live — your reseller page is open at /reseller to anyone with the password." }
        : { tone: "neutral" as const, text: "Set a password to take your reseller page live." };

  return (
    <FormPage
      footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!!codeError} onSave={onSave} />}
    >
      <Section
        title="Reseller page password"
        hint="Your reseller page lives at /reseller. Resellers open it, enter the password below, and see your wholesale prices — regular shoppers never do. Share the link and the password with your resellers."
      >
        {status.tone === "success" ? (
          <Pill tone="success" icon="checkmark-circle-outline" label="Live" />
        ) : null}
        {status.tone === "danger" ? (
          <Hint tone="danger">{status.text}</Hint>
        ) : (
          <Hint>{status.text}</Hint>
        )}
        <Field
          label={hasCode ? "Set a new password" : "Reseller page password"}
          value={code}
          onChangeText={edit(setCode)}
          password
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          maxLength={120}
          placeholder={hasCode ? "Leave blank to keep the current password" : "e.g. NOVALABWHOLESALE"}
          error={codeError}
          hint={
            hasCode
              ? "Your current password can't be shown — it's stored encrypted. Type a new one to replace it. Changing or removing it signs out every reseller using the old one."
              : "At least 4 characters. It's stored encrypted and never shown again, so keep your own copy."
          }
        />
        {hasCode ? (
          <Button
            label="Remove password (re-lock the page)"
            variant="danger"
            icon="lock-closed-outline"
            disabled={save.isPending || !online}
            onPress={onRemove}
          />
        ) : null}
      </Section>

      <Section title="Reseller page wording" hint="What resellers read on the password screen before they get in.">
        <Field label="Title" value={gateTitle} onChangeText={edit(setGateTitle)} placeholder={DEFAULT_RESELLER_GATE_TITLE} maxLength={120} />
        <Field
          label="Instructions"
          value={gateSub}
          onChangeText={edit(setGateSub)}
          placeholder={DEFAULT_RESELLER_GATE_SUB}
          multiline
          maxLength={400}
        />
      </Section>

      <WholesaleList brand={brand} wholesaleWarning={settings.available && !settings.wholesaleAvailable} />
    </FormPage>
  );
}
