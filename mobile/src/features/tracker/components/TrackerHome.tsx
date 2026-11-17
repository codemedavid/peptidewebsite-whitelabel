/**
 * The Tracker tab (TRACKER.md §4): greeting, date and streak; a segmented
 * Today | Calendar | Progress kept in the URL (?view=&date=); the settings
 * gear; pull-to-refresh sync; the undo toast. On the very first open it shows
 * the 3-step onboarding (disclaimer + notification ask), once per account.
 */
import { useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useOnline } from "@/ui/feedback";
import { syncNow, useNow, useToday, useTrackerState } from "../hooks";
import { firstName, greeting, longDate } from "./format";
import { IconButton, SegmentedControl, TText } from "./kit";
import { isOnboarded } from "./onboarding-state";
import { trackerHref, type TrackerView } from "./routes";
import { TRADIUS, TSPACE, useTrackerTheme } from "./theme";
import { SyncStatus } from "./TodayCards";
import { UndoToast } from "./toast";
import { CalendarView } from "./views/CalendarView";
import { ProgressView } from "./views/ProgressView";
import { TodayView } from "./views/TodayView";
import { READING_MAX_WIDTH } from "@/ui/responsive";

const VIEWS: readonly { key: TrackerView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "calendar", label: "Calendar" },
  { key: "progress", label: "Progress" },
];

/** The countdown refreshes this often (whole minutes are shown). */
const HOME_TICK_MS = 15_000;
/** First open on a new phone: wait this long for the account's settings to sync before deciding on onboarding. */
const ONBOARDING_SYNC_WAIT_MS = 2_500;
/** Show the streak from this many doses in a row. */
const MIN_RUN_SHOWN = 2;

/** `onBack`: the store team opens this as a page (More → Peptide Tracker), not a tab. */
export function TrackerHome({ onBack }: { onBack?: () => void } = {}) {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const now = useNow(HOME_TICK_MS);
  const state = useTrackerState();
  const today = useToday(now);
  const isOnline = useOnline();
  const params = useLocalSearchParams<{ view?: string; date?: string }>();
  const view: TrackerView = VIEWS.some((v) => v.key === params.view) ? (params.view as TrackerView) : "today";
  const [isRefreshing, setIsRefreshing] = useState(false);
  useOnboardingGate(state.isLoaded, isOnboarded(state.data.settings), state.lastSyncAt !== null);

  const refresh = async () => {
    setIsRefreshing(true);
    await syncNow();
    setIsRefreshing(false);
  };

  // A profile still named after the store (an owner who never set their own) isn't a first name.
  const displayName = me.community.profile?.displayName || me.actor.displayName;
  const name = displayName && displayName.trim().toLowerCase() !== me.store.name.trim().toLowerCase() ? firstName(displayName) : null;
  const run = today.consistency.run;

  return (
    <View style={[styles.screen, { backgroundColor: th.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + TSPACE.sm }]}>
        <View style={styles.headRow}>
          {onBack ? <IconButton icon="chevron-back" label="Back" onPress={onBack} /> : null}
          <View style={styles.fill}>
            <View style={styles.dateRow}>
              <TText variant="micro" color="faint" numberOfLines={1}>
                {longDate(now)}
              </TText>
              {run >= MIN_RUN_SHOWN ? (
                <View style={[styles.streak, { backgroundColor: th.status.low.soft }]} accessible accessibilityLabel={`${run} doses in a row on schedule`}>
                  <Ionicons name="flame" size={12} color={th.status.low.text} />
                  <TText variant="meta" color={th.status.low.text} tabular style={styles.streakText}>
                    {String(run)}
                  </TText>
                </View>
              ) : null}
            </View>
            <TText variant="title" accessibilityRole="header" numberOfLines={1}>
              {name ? `${greeting(now)}, ${name}` : greeting(now)}
            </TText>
          </View>
          <IconButton icon="flask-outline" label="Vials" onPress={() => router.push(trackerHref.vials())} />
          <IconButton icon="settings-outline" label="Tracker settings" onPress={() => router.push(trackerHref.settings())} />
        </View>
        <SegmentedControl label="Tracker view" options={VIEWS} value={view} onChange={(next) => router.setParams({ view: next, date: undefined })} />
        <SyncStatus isOnline={isOnline} pendingCount={state.pendingCount} hasSaveError={state.hasSaveError} hasLoadError={state.hasLoadError} rejectedCount={state.rejectedCount} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={th.brand} colors={[th.brand]} />}
      >
        {!state.isLoaded ? (
          <LoadingToday />
        ) : view === "today" ? (
          <TodayView now={now} today={today} />
        ) : view === "calendar" ? (
          <CalendarView key={params.date ?? ""} now={now} initialDate={params.date} />
        ) : (
          <ProgressView now={now} />
        )}
      </ScrollView>
      <UndoToast />
    </View>
  );
}

/** Opens onboarding once the account's settings are known to lack the "seen" mark. */
function useOnboardingGate(isLoaded: boolean, isDone: boolean, hasSynced: boolean): void {
  const opened = useRef(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!isLoaded || hasSynced) return;
    const id = setTimeout(() => setWaited(true), ONBOARDING_SYNC_WAIT_MS);
    return () => clearTimeout(id);
  }, [isLoaded, hasSynced]);
  useEffect(() => {
    if (opened.current || !isLoaded || isDone || !(hasSynced || waited)) return;
    opened.current = true;
    router.push(trackerHref.onboarding());
  }, [isLoaded, isDone, hasSynced, waited]);
}

/** Same shapes as Today, so nothing jumps when the store arrives. */
function LoadingToday() {
  const th = useTrackerTheme();
  return (
    <View style={styles.loading} accessible accessibilityLabel="Loading your tracker" accessibilityRole="progressbar">
      <View style={[styles.skeletonHero, { backgroundColor: th.brandSoft }]} />
      <View style={[styles.skeletonCard, { backgroundColor: th.surfaceAlt }]} />
      <View style={[styles.skeletonCard, { backgroundColor: th.surfaceAlt }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  header: { paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.sm, gap: TSPACE.md, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  headRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  dateRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, marginBottom: 2 },
  streak: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: TRADIUS.pill },
  streakText: { fontSize: 12, lineHeight: 16 },
  content: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, paddingBottom: 96, width: "100%", maxWidth: READING_MAX_WIDTH, alignSelf: "center" },
  loading: { gap: TSPACE.lg },
  skeletonHero: { height: 300, borderRadius: TRADIUS.xl },
  skeletonCard: { height: 110, borderRadius: TRADIUS.lg },
});
