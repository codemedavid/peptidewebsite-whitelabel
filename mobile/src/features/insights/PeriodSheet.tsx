import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { InsightsCompare, InsightsQuery, InsightsRange } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Segmented } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { formatKey, storeToday } from "./dates";
import { RangeCalendar } from "./RangeCalendar";

// Full-screen period picker for Insights: every preset, a custom range on a
// month grid, and what to compare with. Nothing applies until "Show report",
// so flicking through options never fires a request per tap.

export const PRESET_LABELS: Record<InsightsRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  "90d": "Last 90 days",
  this_year: "This year",
  "12m": "Last 12 months",
  all: "All time",
  custom: "Custom",
};

const PRESETS: InsightsRange[] = [
  "today", "yesterday", "this_week", "7d", "30d", "this_month",
  "last_month", "90d", "this_year", "12m", "all",
];

const COMPARE: readonly { key: InsightsCompare; label: string }[] = [
  { key: "previous", label: "Previous" },
  { key: "year", label: "Last year" },
  { key: "none", label: "Off" },
];

type Props = {
  visible: boolean;
  value: InsightsQuery;
  onClose: () => void;
  onApply: (q: InsightsQuery) => void;
};

export function PeriodSheet({ visible, value, onClose, onApply }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<InsightsQuery>(value);
  const today = storeToday();

  // Each opening starts from the report on screen (state adjusted during render, not in an effect).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }

  const custom = draft.range === "custom";
  const customReady = !custom || Boolean(draft.from && draft.to);
  const set = (patch: Partial<InsightsQuery>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <View
          style={[
            styles.bar,
            { borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingTop: Platform.OS === "android" ? insets.top + SPACE.sm : SPACE.md },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10} onPress={onClose} style={styles.side}>
            <AppText variant="bodyStrong" color="link">Cancel</AppText>
          </Pressable>
          <AppText variant="heading" accessibilityRole="header">Report period</AppText>
          <View style={styles.side} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={{ gap: SPACE.sm }}>
            <AppText variant="overline" color="muted">QUICK RANGES</AppText>
            <View style={styles.wrap}>
              {PRESETS.map((p) => {
                const active = draft.range === p;
                return (
                  <Pressable
                    key={p}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => set({ range: p, from: undefined, to: undefined, granularity: undefined })}
                    style={[
                      styles.preset,
                      { borderColor: active ? t.colors.text : t.colors.border, backgroundColor: active ? t.colors.text : t.colors.surface },
                    ]}
                  >
                    <AppText variant="label" color={active ? t.colors.bg : "text"}>{PRESET_LABELS[p]}</AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: custom ? t.colors.text : t.colors.border }]}>
            <View style={{ gap: 2 }}>
              <AppText variant="overline" color="muted">CUSTOM RANGE</AppText>
              <AppText variant="bodyStrong">
                {custom && draft.from
                  ? `${formatKey(draft.from)} – ${draft.to ? formatKey(draft.to) : "pick an end date"}`
                  : "Tap a start date, then an end date"}
              </AppText>
            </View>
            <RangeCalendar
              from={custom ? (draft.from ?? null) : null}
              to={custom ? (draft.to ?? null) : null}
              max={today}
              onChange={(from, to) => set({ range: "custom", from: from ?? undefined, to: to ?? undefined, granularity: undefined })}
            />
          </View>

          <View style={{ gap: SPACE.sm }}>
            <AppText variant="overline" color="muted">COMPARE WITH</AppText>
            <Segmented segments={COMPARE} value={draft.compare ?? "previous"} onChange={(compare) => set({ compare })} />
            <AppText variant="caption" color="muted">
              {draft.range === "all"
                ? "All time has nothing earlier to compare with."
                : (draft.compare ?? "previous") === "year"
                  ? "The same dates one year earlier."
                  : (draft.compare ?? "previous") === "none"
                    ? "Show this period on its own."
                    : "The period right before, of the same length."}
            </AppText>
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingBottom: Math.max(insets.bottom, SPACE.md) }]}>
          <Button label="Show report" disabled={!customReady} onPress={() => onApply(draft)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 70 },
  body: { padding: SPACE.lg, gap: SPACE.xl, paddingBottom: SPACE.xxxl },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  preset: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill, borderWidth: 1 },
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACE.lg, gap: SPACE.md },
  footer: { padding: SPACE.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
