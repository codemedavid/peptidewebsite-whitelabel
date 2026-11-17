/**
 * TRACKER SETTINGS: reminders (with the phone's notification permission and a
 * way to turn it on, and whether names show on the lock screen), units, vials,
 * sync (incl. changes the server refused), the disclaimer, privacy, and this
 * phone's copy — re-download, remove it from the phone, or delete everything.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { useOnline } from "@/ui/feedback";
import { clearSyncRejections, resetTracker, syncNow, updateSettings, useTrackerState } from "../../hooks";
import { LOW_DOSES } from "../../lib/vials";
import type { TrackerSettings as Settings } from "../../lib/types";
import { ensureTrackerNotificationPermission, REMINDERS_SUPPORTED } from "../../reminders";
import { confirm, notify } from "../dialog";
import { TimeField, ToggleRow } from "../fields";
import { plural } from "../format";
import { Card, haptic, IconButton, PressButton, SectionHeader, SegmentedControl, TText, type IconName } from "../kit";
import { trackerHref } from "../routes";
import { TOUCH_MIN, TSPACE, useTrackerTheme } from "../theme";
import { showTrackerToast, UndoToast } from "../toast";
import { removeTrackerFromPhone, resetThisPhone, timeAgo } from "../settings-actions";

type Permission = "granted" | "askable" | "blocked" | "unsupported" | "unknown";

function back(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

async function readPermission(): Promise<Permission> {
  if (!REMINDERS_SUPPORTED) return "unsupported";
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? "granted" : p.canAskAgain ? "askable" : "blocked";
  } catch {
    return "unknown";
  }
}

/** The phone's notification permission, re-read whenever the app comes back (the user may have changed it in Settings). */
function usePermission(): [Permission, () => Promise<void>] {
  const [state, setState] = useState<Permission>(REMINDERS_SUPPORTED ? "unknown" : "unsupported");
  const reread = useCallback(() => readPermission().then(setState), []);
  useEffect(() => {
    let isLive = true;
    const apply = () => readPermission().then((p) => (isLive ? setState(p) : undefined));
    void apply();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void apply();
    });
    return () => {
      isLive = false;
      sub.remove();
    };
  }, []);
  return [state, reread];
}

export function TrackerSettings() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const { me, scope } = useSignedIn();
  const { signOut } = useSession();
  const state = useTrackerState();
  const isOnline = useOnline();
  const [permission, rereadPermission] = usePermission();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const s = state.data.settings;
  const store = me.store.name;

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  /** Turning a reminder on asks for permission (once) when it hasn't been given. */
  const setReminder = (patch: Partial<Settings>) => {
    set(patch);
    if (Object.values(patch).some((v) => v === true) && permission === "askable") void enable();
  };

  const enable = async () => {
    if (permission === "blocked") {
      void Linking.openSettings();
      return;
    }
    const granted = await ensureTrackerNotificationPermission();
    await rereadPermission();
    if (!granted) notify("Notifications are off", "Turn them on for this app in your phone’s Settings to get reminders.");
  };

  const sync = async () => {
    setIsSyncing(true);
    await syncNow();
    setIsSyncing(false);
    haptic("success");
  };

  const onResetPhone = () =>
    confirm(
      "Reset the tracker on this phone?",
      "This clears the tracker from this phone and downloads it again from your account. Use it if something looks out of date. Nothing in your account is deleted.",
      "Reset this phone",
      () => {
        setIsResetting(true);
        void resetThisPhone(scope).then((r) => {
          setIsResetting(false);
          if (r === "pending" || r === "offline") {
            notify("Not reset", "Some changes on this phone haven’t reached your account yet, or the account couldn’t be reached. Connect to the internet, tap Sync now, then try again, so nothing is lost.");
            return;
          }
          if (r === "unavailable") {
            notify("Not reset", "Your tracker can’t be downloaded right now, so this phone’s copy was kept.");
            return;
          }
          showTrackerToast({ message: "Tracker re-downloaded from your account", icon: "cloud-download-outline" });
        });
      },
      false,
    );

  const onRemoveFromPhone = () =>
    confirm(
      "Remove tracker data from this phone?",
      "This removes your tracker from this phone (and copies other accounts left here once they’re synced), then signs you out so nothing downloads again. Everything stays in your account and comes back when you sign in.",
      "Remove and sign out",
      () => {
        setIsRemoving(true);
        void removeTrackerFromPhone(scope).then((r) => {
          setIsRemoving(false);
          if (r.outcome === "pending") {
            notify("Not removed", "Some changes on this phone haven’t reached your account yet. Connect to the internet, tap Sync now, then try again, so nothing is lost.");
            return;
          }
          if (r.outcome === "unavailable") {
            notify("Not removed", "Your tracker isn’t ready on this phone yet. Try again in a moment.");
            return;
          }
          void signOut("Your tracker was removed from this phone. It’s still in your account.");
        });
      },
      false,
    );

  const onDeleteAll = () =>
    confirm(
      "Delete all tracker data?",
      "This deletes every protocol, dose, vial and check-in, on this phone and in your account, on every device. It can’t be undone.",
      "Delete everything",
      () => {
        resetTracker();
        showTrackerToast({ message: "Tracker data deleted", icon: "trash-outline" });
        router.replace(trackerHref.home());
      },
    );

  const syncLine = !isOnline
    ? state.pendingCount > 0
      ? `Offline · ${plural(state.pendingCount, "change")} saved on this phone, will sync later`
      : "Offline · everything is saved on this phone"
    : state.pendingCount > 0
      ? `${plural(state.pendingCount, "change")} waiting to sync`
      : `Synced to your account ${timeAgo(state.lastSyncAt, new Date())}`;

  return (
    <View style={[styles.screen, { backgroundColor: th.bg }]}>
      <View style={[styles.bar, { paddingTop: insets.top + TSPACE.xs }]}>
        <IconButton icon="chevron-back" label="Back" onPress={back} />
        <TText variant="title" accessibilityRole="header" style={styles.fill} numberOfLines={1}>
          Tracker settings
        </TText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TSPACE.xxxl }]}>
        <Card tone="brand" style={styles.privacy}>
          <Ionicons name="lock-closed" size={20} color={th.brandText} />
          <View style={styles.fill}>
            <TText variant="bodyStrong">{`Your tracker is private. ${store} can’t see it.`}</TText>
            <TText variant="meta" color="soft">
              Your tracker is saved on this phone and in your account.
            </TText>
          </View>
        </Card>

        <Group title="Reminders">
          <PermissionRow permission={permission} onEnable={() => void enable()} />
          <ToggleRow label="Dose reminders" hint="At each dose time, with Taken and Snooze 1 h buttons." value={s.doseReminders} onChange={(v) => setReminder({ doseReminders: v })} />
          <Divider />
          <ToggleRow label="Refill reminders" hint={`The morning after a vial gets to about ${LOW_DOSES} doses left.`} value={s.refillReminders} onChange={(v) => setReminder({ refillReminders: v })} />
          <Divider />
          <ToggleRow label="Daily check-in reminder" hint="A nudge to log how you feel." value={s.checkinReminder} onChange={(v) => setReminder({ checkinReminder: v })} />
          {s.checkinReminder ? <TimeField label="Check-in reminder time" value={s.checkinTime} onChange={(checkinTime) => set({ checkinTime })} /> : null}
          <Divider />
          <ToggleRow
            label="Show peptide names in reminders"
            hint="Names and amounts will be visible on your lock screen."
            value={s.showNamesInNotifications}
            onChange={(v) => set({ showNamesInNotifications: v })}
          />
        </Group>

        <Group title="Units">
          <TText variant="meta" color="soft">
            Weight
          </TText>
          <SegmentedControl
            label="Weight unit"
            options={[
              { key: "kg", label: "kg" },
              { key: "lb", label: "lb" },
            ]}
            value={s.weightUnit}
            onChange={(weightUnit) => set({ weightUnit })}
          />
          <TText variant="meta" color="faint">
            Your weigh-ins never change. They’re shown in the unit you pick.
          </TText>
          <Divider />
          <ToggleRow label="Suggest the next injection site" hint="Rotates sites; you can always pick another." value={s.suggestSites} onChange={(v) => set({ suggestSites: v })} />
        </Group>

        <Group title="Your tracker">
          <LinkRow icon="flask-outline" label="Vials" hint="What’s left, doses left, use-by dates" onPress={() => router.push(trackerHref.vials())} />
          <Divider />
          <LinkRow icon="information-circle-outline" label="View disclaimer" hint="Tracking only. Not medical advice" onPress={() => router.push(trackerHref.disclaimer())} />
        </Group>

        <Group title="Sync">
          <View style={styles.syncRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={syncLine}>
            <Ionicons name={state.pendingCount > 0 || !isOnline ? "cloud-upload-outline" : "cloud-done-outline"} size={20} color={th.inkSoft} />
            <TText variant="body" style={styles.fill}>
              {syncLine}
            </TText>
          </View>
          {state.hasSaveError ? (
            <TText variant="meta" color={th.status.missed.text}>
              This phone couldn’t save your latest change. Free up some space and try again.
            </TText>
          ) : null}
          {state.rejectedCount > 0 ? (
            <View style={styles.rejected} accessible accessibilityLabel={`${plural(state.rejectedCount, "change")} couldn’t sync`}>
              <TText variant="meta" color="soft">
                {`${plural(state.rejectedCount, "change")} couldn’t sync. They’re still on this phone; your account didn’t accept them${state.lastRejectReason ? ` (${state.lastRejectReason})` : ""}.`}
              </TText>
              <PressButton label="Dismiss" icon="checkmark" tone="ghost" size="sm" onPress={clearSyncRejections} />
            </View>
          ) : null}
          <PressButton label="Sync now" icon="sync" tone="secondary" size="md" isLoading={isSyncing} isDisabled={!isOnline} onPress={() => void sync()} />
          <TText variant="meta" color="faint">
            Your tracker is saved on this phone first and backed up to your account, so it comes with you to a new phone.
          </TText>
        </Group>

        <Group title="This phone">
          <PressButton label="Re-download tracker on this phone" icon="refresh" tone="secondary" size="md" isLoading={isResetting} isDisabled={!isOnline} onPress={onResetPhone} accessibilityHint="Clears this phone and downloads your tracker again from your account" />
          <TText variant="meta" color="faint">
            Clears this phone’s copy and re-downloads it from your account. Needs a connection.
          </TText>
          <PressButton label="Remove tracker data from this phone" icon="phone-portrait-outline" tone="secondary" size="md" isLoading={isRemoving} onPress={onRemoveFromPhone} accessibilityHint="Removes the tracker from this phone and signs you out; your account keeps it" />
          <TText variant="meta" color="faint">
            Signing out keeps your tracker on this phone so no change is ever lost. Use this to take it off. You’ll be signed out.
          </TText>
          <PressButton label="Delete all tracker data" icon="trash-outline" tone="danger" size="md" onPress={onDeleteAll} />
        </Group>

        <TText variant="meta" color="faint" style={styles.center}>
          For tracking only. This app never suggests doses. Talk to your doctor.
        </TText>
      </ScrollView>
      <UndoToast bottom={insets.bottom + TSPACE.lg} />
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionHeader title={title} />
      <Card style={styles.groupCard}>{children}</Card>
    </View>
  );
}

function Divider() {
  const th = useTrackerTheme();
  return <View style={[styles.divider, { backgroundColor: th.line }]} />;
}

function LinkRow({ icon, label, hint, onPress }: { icon: IconName; label: string; hint?: string; onPress: () => void }) {
  const th = useTrackerTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
    >
      <Ionicons name={icon} size={22} color={th.brandText} />
      <View style={styles.fill}>
        <TText variant="bodyStrong">{label}</TText>
        {hint ? (
          <TText variant="meta" color="soft">
            {hint}
          </TText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={th.inkFaint} />
    </Pressable>
  );
}

const PERMISSION_COPY: Record<Exclude<Permission, "unknown">, { icon: IconName; text: string; action: string | null }> = {
  granted: { icon: "notifications", text: "Notifications are on for this phone.", action: null },
  askable: { icon: "notifications-off-outline", text: "Notifications aren’t on yet, so reminders can’t reach you.", action: "Turn on notifications" },
  blocked: { icon: "notifications-off-outline", text: "Notifications are off for this app in your phone’s Settings.", action: "Open phone settings" },
  unsupported: { icon: "phone-portrait-outline", text: "Reminders work in the phone app. Here, due doses show on Today.", action: null },
};

function PermissionRow({ permission, onEnable }: { permission: Permission; onEnable: () => void }) {
  const th = useTrackerTheme();
  if (permission === "unknown") return null;
  const copy = PERMISSION_COPY[permission];
  const isOk = permission === "granted";
  const color = isOk ? th.status.done.text : permission === "unsupported" ? th.inkSoft : th.status.low.text;
  return (
    <View style={styles.permission}>
      <View style={styles.permissionText} accessible accessibilityLabel={copy.text}>
        <Ionicons name={copy.icon} size={20} color={color} />
        <TText variant="meta" color={color} style={styles.fill}>
          {copy.text}
        </TText>
      </View>
      {copy.action ? <PressButton label={copy.action} icon={permission === "blocked" ? "open-outline" : "notifications-outline"} size="md" onPress={onEnable} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  pressed: { opacity: 0.7 },
  center: { textAlign: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.xs },
  content: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, gap: TSPACE.section },
  privacy: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  group: { gap: TSPACE.sm },
  groupCard: { gap: TSPACE.sm },
  divider: { height: StyleSheet.hairlineWidth },
  link: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: TOUCH_MIN + 8 },
  syncRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: TOUCH_MIN },
  permission: { gap: TSPACE.sm, paddingBottom: TSPACE.xs },
  permissionText: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  rejected: { gap: TSPACE.xs },
});
