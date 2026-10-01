import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, type IconName } from "./primitives";

/**
 * Dashboard building blocks shared by Home, Insights and Customers — the
 * "seller centre" layer on top of the base primitives.
 */

const tap = () => void Haptics.selectionAsync().catch(() => undefined);

// ── Section header: green eyebrow + optional serif title + action link ──────

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title?: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <AppText variant="overline" color="link" accessibilityRole="header">
          {eyebrow.toUpperCase()}
        </AppText>
        {title ? (
          <AppText variant="title" style={styles.sectionTitle}>
            {title}
          </AppText>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={10}
          onPress={action.onPress}
          style={({ pressed }) => [styles.sectionAction, pressed ? { opacity: 0.6 } : null]}
        >
          <AppText variant="label" color="link">
            {action.label}
          </AppText>
          <Ionicons name="chevron-forward" size={14} color={t.brand.link} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Chips: a single-select row (date ranges, filters) ───────────────────────

export function Chips<K extends string>({
  options,
  value,
  onChange,
  onBand,
  label,
}: {
  options: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (k: K) => void;
  /** Rendered on the dark hero band. */
  onBand?: boolean;
  label: string;
}) {
  const t = useTheme();
  const idle = onBand ? t.colors.bandMuted : t.colors.textMuted;
  const activeBg = onBand ? t.colors.bandText : t.colors.text;
  const activeFg = onBand ? t.colors.band : t.colors.bg;
  const line = onBand ? t.colors.bandLine : t.colors.border;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={label}
      contentContainerStyle={styles.chips}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              tap();
              onChange(o.key);
            }}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: active ? activeBg : line, backgroundColor: active ? activeBg : "transparent" },
              pressed && !active ? { opacity: 0.7 } : null,
            ]}
          >
            <AppText variant="label" color={active ? activeFg : idle}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Delta: ▲ 12.5% / ▼ 3% / — ────────────────────────────────────────────────

export function Delta({ value, onBand, compact }: { value: number | null; onBand?: boolean; compact?: boolean }) {
  const t = useTheme();
  if (value === null) {
    return (
      <AppText variant="caption" color={onBand ? t.colors.bandMuted : "faint"}>
        {compact ? "—" : "No earlier data"}
      </AppText>
    );
  }
  const up = value > 0;
  const flat = value === 0;
  const c = t.tone(flat ? "neutral" : up ? "success" : "danger");
  const icon: IconName = flat ? "remove" : up ? "arrow-up" : "arrow-down";
  const words = flat ? "No change" : `${up ? "Up" : "Down"} ${Math.abs(value)} percent`;
  return (
    <View
      accessible
      accessibilityLabel={words}
      style={[styles.delta, { backgroundColor: onBand ? "rgba(255,255,255,0.1)" : c.bg }]}
    >
      <Ionicons name={icon} size={12} color={onBand ? t.colors.chartOnBand : c.fg} />
      <AppText variant="caption" color={onBand ? t.colors.bandText : c.fg} style={{ fontWeight: "600" }}>
        {`${Math.abs(value)}%`}
      </AppText>
    </View>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  label,
  value,
  delta,
  icon,
  onPress,
  style,
}: {
  label: string;
  value: string;
  delta?: number | null;
  icon?: IconName;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${value}`}
      disabled={!onPress}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.stat,
        { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border },
        style,
      ]}
    >
      <View style={styles.statTop}>
        {icon ? <Ionicons name={icon} size={16} color={t.colors.textFaint} /> : null}
        <AppText variant="caption" color="muted" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </AppText>
      </View>
      <AppText variant="stat" numberOfLines={1} style={styles.tabular}>
        {value}
      </AppText>
      {delta !== undefined ? <Delta value={delta} compact /> : null}
    </Pressable>
  );
}

// ── Quick action (the seller-centre shortcut grid) ───────────────────────────

export function QuickAction({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.quick, pressed ? { opacity: 0.7 } : null]}
    >
      <View style={[styles.quickIcon, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Ionicons name={icon} size={22} color={t.brand.link} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: t.brand.primary, borderColor: t.colors.bg }]}>
            <AppText variant="caption" color={t.brand.onPrimary} style={styles.badgeText}>
              {badge > 99 ? "99+" : String(badge)}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="caption" color="muted" numberOfLines={1} style={{ textAlign: "center" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ── Panel: a white card on paper ─────────────────────────────────────────────

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.md, marginBottom: SPACE.md },
  sectionTitle: { fontSize: 24, lineHeight: 28, marginTop: 2 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
  chips: { gap: SPACE.sm, paddingVertical: 2 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  delta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  stat: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 104,
    padding: SPACE.lg,
    gap: 6,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabular: { fontVariant: ["tabular-nums"] },
  quick: { flex: 1, alignItems: "center", gap: 6, minWidth: 64, minHeight: TOUCH },
  quickIcon: {
    width: 54,
    height: 54,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: "700" },
  panel: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACE.lg },
});
