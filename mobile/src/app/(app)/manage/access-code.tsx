import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { brandName } from "@/features/admin/setup/rules";
import { setupKeys, useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { Button, Pill } from "@/ui/primitives";

const DEFAULT_HEADING = "Enter access code";
const HEADING_MAX = 120; // setGateSettingsAction slices to 120
const CODE_MIN = 6; // rotateAccessCodeAction's minimum

type GateSettings = { enabled: boolean; heading: string; hasCode: boolean };

/**
 * The website's Access Code manager (AdminAccessCode → getGateSettingsAction /
 * setGateSettingsAction / rotateAccessCodeAction): the "enter a code to view
 * this store" wall. The code is stored hashed server-side and never comes back
 * — only whether one is set. Setting a code turns the gate on and signs every
 * current visitor out; the gate can't be switched on without a code.
 */
export default function AccessCodeScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Access code" }} />
      <Loadable query={brand}>
        {(b) =>
          b.showAdminAccessCode === true ? (
            <Gate storeName={brandName(b)} />
          ) : (
            <EmptyState
              icon="lock-closed-outline"
              title="Access Code isn't available"
              body="Your provider hasn't switched the storefront access gate on for this store yet."
            />
          )
        }
      </Loadable>
    </>
  );
}

function Gate({ storeName }: { storeName: string }) {
  const { scope } = useSignedIn();
  // Under the admin key, so every setup save (and this screen's own) refetches it.
  const settings = useQuery({
    queryKey: [...setupKeys.all(scope), "access-gate"],
    queryFn: async () => unwrap(await adminBridge.call<GateSettings | { error: string }>("getGateSettingsAction")),
  });
  return <Loadable query={settings}>{(s) => <Editor settings={s} storeName={storeName} />}</Loadable>;
}

function Editor({ settings, storeName }: { settings: GateSettings; storeName: string }) {
  const [savedHeading, setSavedHeading] = useState(settings.heading);
  const [heading, setHeading] = useState(settings.heading);
  const [newCode, setNewCode] = useState("");
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const toggleSave = useSetupSave("setGateSettingsAction");
  const headingSave = useSetupSave("setGateSettingsAction");
  const rotate = useSetupSave("rotateAccessCodeAction");

  const nextHeading = heading.trim() || DEFAULT_HEADING;
  const dirty = nextHeading !== savedHeading || newCode.trim().length > 0;
  useDiscardGuard(dirty);

  // Show the switch where the owner put it while the save is in flight.
  const pending = toggleSave.isPending ? (toggleSave.variables as { enabled?: boolean } | undefined) : undefined;
  const enabled = pending?.enabled ?? settings.enabled;
  const { hasCode } = settings;
  const codeTrim = newCode.trim();
  const codeError = codeTrim.length > 0 && codeTrim.length < CODE_MIN ? `Access code must be at least ${CODE_MIN} characters.` : null;

  function setGate(next: boolean) {
    const run = () =>
      toggleSave.mutate(
        { enabled: next, heading: savedHeading },
        { onError: (e) => Alert.alert("Couldn't save", e.message) },
      );
    if (next) return run();
    Alert.alert("Open your store to everyone?", "Visitors will no longer need the code. Your code is kept, so you can turn the gate back on anytime.", [
      { text: "Cancel", style: "cancel" },
      { text: "Turn gate off", style: "destructive", onPress: run },
    ]);
  }

  function onRotate() {
    if (codeTrim.length < CODE_MIN) {
      Alert.alert("Code too short", `Access code must be at least ${CODE_MIN} characters.`);
      return;
    }
    const body = hasCode
      ? "The old code stops working immediately and everyone already inside is signed out. The gate turns on."
      : "Your store becomes private right away — visitors will need this code to see it.";
    Alert.alert(hasCode ? "Update the access code?" : "Set the access code?", body, [
      { text: "Cancel", style: "cancel" },
      {
        text: hasCode ? "Update code" : "Set code",
        onPress: () =>
          rotate.mutate(codeTrim, {
            onSuccess: () => {
              setNewCode("");
              Alert.alert("Code saved", "The gate is now ON. Visitors need the code, and anyone already in was signed out.");
            },
            onError: (e) => Alert.alert("Couldn't update the code", e.message),
          }),
      },
    ]);
  }

  function onSaveHeading() {
    headingSave.mutate(
      { enabled: settings.enabled, heading: nextHeading },
      {
        onSuccess: () => {
          setSavedHeading(nextHeading);
          setHeading(nextHeading);
          showSaved();
        },
        onError: (e) => Alert.alert("Couldn't save", e.message),
      },
    );
  }

  const status =
    enabled && hasCode
      ? { tone: "success" as const, icon: "lock-closed-outline" as const, label: "Gate is ON", hint: `Visitors need the code to view ${storeName || "your store"}.` }
      : hasCode
        ? { tone: "warning" as const, icon: "lock-open-outline" as const, label: "Gate is OFF", hint: "A code is set but the gate is off — your store is currently open to everyone." }
        : { tone: "neutral" as const, icon: "key-outline" as const, label: "No code set", hint: "Set a code below — that turns the gate on automatically." };

  return (
    <FormPage
      footer={
        <SaveBar
          dirty={nextHeading !== savedHeading}
          saving={headingSave.isPending}
          saved={flash}
          disabled={nextHeading === savedHeading}
          label="Save heading"
          onSave={onSaveHeading}
        />
      }
    >
      <Section
        title="Storefront gate"
        hint="When the gate is on, visitors must enter the access code before they can see your store. Changing the code signs out everyone who already entered the old one."
      >
        <Pill tone={status.tone} icon={status.icon} label={status.label} />
        <Hint>{status.hint}</Hint>
        <ToggleRow
          label="Require an access code to view the store"
          hint={hasCode ? undefined : "Set a code first — the gate can't be enabled without one."}
          value={enabled}
          disabled={!hasCode || toggleSave.isPending}
          onChange={setGate}
        />
      </Section>

      <Section
        title={hasCode ? "Change access code" : "Set access code"}
        hint={`Saving a code turns the gate on and makes your store private right away. The code is stored hashed and never shown again.${hasCode ? " Setting a new one immediately invalidates the old one." : ""}`}
      >
        <Field
          label={hasCode ? "New access code" : "Access code"}
          value={newCode}
          onChangeText={(v) => {
            hideSaved();
            setNewCode(v);
          }}
          placeholder={`At least ${CODE_MIN} characters`}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          error={codeError}
          hint="Share it only with the customers you want to let in."
        />
        <Button
          label={rotate.isPending ? "Saving…" : hasCode ? "Update code" : "Set code"}
          icon="key-outline"
          loading={rotate.isPending}
          disabled={codeTrim.length < CODE_MIN}
          onPress={onRotate}
        />
      </Section>

      <Section title="Gate heading" hint="The headline shown on the access-code screen.">
        <Field
          label="Heading"
          value={heading}
          onChangeText={(v) => {
            hideSaved();
            setHeading(v);
          }}
          maxLength={HEADING_MAX}
          placeholder={DEFAULT_HEADING}
          hint="Leave blank to use “Enter access code”."
        />
      </Section>
    </FormPage>
  );
}
