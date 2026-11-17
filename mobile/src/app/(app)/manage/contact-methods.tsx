import { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoreContactChannelType } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { setupKeys, success } from "@/features/admin/setup/data";
import { FormPage, Loadable, SaveBar, Section, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { CONTACT_CHANNELS, channelHint, channelMeta } from "@/features/contact/channels";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Pill } from "@/ui/primitives";

/** branding.config.contactChannels, as getStoreContactMethodsAction returns it. */
type Channel = { type: StoreContactChannelType; destination: string; enabled: boolean };

/**
 * The website's Contact Methods (AdminContactMethods → saveStoreContactMethodsAction):
 * where customers message the store about orders, and where app members ask
 * for a new password. Owner-only, like the website view.
 */
export default function ContactMethodsScreen() {
  const { scope } = useSignedIn();
  const q = useQuery({
    queryKey: [...setupKeys.all(scope), "contact-methods"],
    queryFn: async () => (await callAction<{ ok: true; channels: Channel[] }>("getStoreContactMethodsAction")).channels,
  });
  return (
    <>
      <Stack.Screen options={{ title: "Contact methods" }} />
      <Loadable query={q}>{(channels) => <Editor initial={channels} />}</Loadable>
    </>
  );
}

function ChannelCard({
  c,
  error,
  onChange,
}: {
  c: Channel;
  error: string | null;
  onChange: (patch: Partial<Channel>) => void;
}) {
  const t = useTheme();
  const meta = channelMeta(c.type);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: c.enabled ? meta.color : t.colors.border, borderWidth: c.enabled ? 1.5 : StyleSheet.hairlineWidth },
      ]}
    >
      <Pressable
        onPress={() => onChange({ enabled: !c.enabled })}
        accessibilityRole="switch"
        accessibilityState={{ checked: c.enabled }}
        accessibilityLabel={`${meta.label}. ${c.enabled ? "On" : "Off"}`}
        style={styles.head}
      >
        <View style={[styles.badge, { backgroundColor: c.enabled ? meta.color : t.colors.surfaceAlt }]}>
          <Ionicons name={meta.icon} size={18} color={c.enabled ? "#fff" : t.colors.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{meta.label}</AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {c.enabled ? (c.destination.trim() || "Add your details below") : "Off"}
          </AppText>
        </View>
        <Switch
          value={c.enabled}
          onValueChange={(enabled) => onChange({ enabled })}
          trackColor={{ true: meta.color, false: t.colors.border }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {c.enabled ? (
        <Field
          label={meta.type === "gmail" ? "Email address" : meta.keyboard === "phone-pad" ? "Phone number" : "Username or number"}
          value={c.destination}
          onChangeText={(destination) => onChange({ destination })}
          placeholder={meta.placeholder}
          keyboardType={meta.keyboard}
          autoCapitalize="none"
          autoCorrect={false}
          hint={meta.hint}
          error={error}
        />
      ) : null}
    </View>
  );
}

function Editor({ initial }: { initial: Channel[] }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { scope } = useSignedIn();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [flash, showSaved, hideSaved] = useSavedFlash();

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useDiscardGuard(dirty);
  const errors = new Map(draft.map((c) => [c.type, c.enabled ? channelHint(c.type, c.destination) : null]));
  const live = draft.filter((c) => c.enabled && c.destination.trim());
  const ordered = CONTACT_CHANNELS.map((m) => draft.find((c) => c.type === m.type)).filter((c): c is Channel => !!c);

  const update = (type: StoreContactChannelType, patch: Partial<Channel>) => {
    hideSaved();
    setServerError(null);
    setDraft((prev) => prev.map((c) => (c.type === type ? { ...c, ...patch } : c)));
  };

  async function onSave() {
    if ([...errors.values()].some(Boolean)) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    try {
      const res = await callAction<{ ok: true; channels: Channel[] }>("saveStoreContactMethodsAction", { channels: draft });
      success();
      setSaved(res.channels);
      setDraft(res.channels);
      setShowErrors(false);
      showSaved();
      void qc.invalidateQueries({ queryKey: setupKeys.all(scope) });
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={saving} saved={flash} onSave={() => void onSave()} />}>
      <Section
        title="Where customers reach you"
        hint="Used when a customer sends their order, and in the app when a member forgot their password and asks you for a new one. Turn on the apps you reply on."
      >
        <Pill
          tone={live.length ? "success" : "warning"}
          icon={live.length ? "chatbubbles-outline" : "alert-circle-outline"}
          label={live.length ? `${live.length} way${live.length === 1 ? "" : "s"} to reach you` : "No contact method on yet"}
        />
      </Section>
      {ordered.map((c) => (
        <ChannelCard key={c.type} c={c} error={showErrors ? (errors.get(c.type) ?? null) : null} onChange={(p) => update(c.type, p)} />
      ))}
      {serverError ? (
        <View style={[styles.error, { backgroundColor: t.tone("danger").bg }]}>
          <AppText variant="caption" style={{ color: t.tone("danger").fg }}>
            {serverError}
          </AppText>
        </View>
      ) : null}
    </FormPage>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, padding: SPACE.md, gap: SPACE.md },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: 44 },
  badge: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  error: { padding: SPACE.md, borderRadius: RADIUS.md },
});
