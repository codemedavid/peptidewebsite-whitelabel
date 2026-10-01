import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CustomerRow, CustomerSegment, Tone } from "@contract";
import { formatWhen } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Pill, type IconName } from "@/ui/primitives";

export const SEGMENT_META: Record<CustomerSegment, { label: string; tone: Tone; icon: IconName }> = {
  new: { label: "New", tone: "info", icon: "sparkles-outline" },
  returning: { label: "Returning", tone: "success", icon: "repeat-outline" },
  loyal: { label: "Loyal", tone: "success", icon: "star-outline" },
};

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "·"
  );
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.tone("success").bg },
      ]}
    >
      <AppText brandFont color={t.tone("success").fg} style={{ fontSize: size * 0.42, lineHeight: size * 0.52 }}>
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

export const CustomerRowItem = memo(function CustomerRowItem({ c, onPress }: { c: CustomerRow; onPress: () => void }) {
  const t = useTheme();
  const seg = SEGMENT_META[c.segment];
  const orders = `${c.orders} ${c.orders === 1 ? "order" : "orders"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.name}, ${orders}, spent ${c.spentLabel}, ${seg.label}${c.lapsed ? ", inactive" : ""}`}
      accessibilityHint="Opens the customer"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border },
      ]}
    >
      <Avatar name={c.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {c.name}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {`${orders} · last ${formatWhen(c.lastAt).toLowerCase()}`}
        </AppText>
        <View style={styles.pills}>
          <Pill tone={seg.tone} icon={seg.icon} label={seg.label} size="sm" />
          {c.lapsed ? <Pill tone="warning" icon="moon-outline" label="Inactive 60d+" size="sm" /> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <AppText variant="heading" style={styles.tabular}>
          {c.spentLabel}
        </AppText>
        <AppText variant="caption" color="faint">
          spent
        </AppText>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pills: { flexDirection: "row", gap: 6, marginTop: 4 },
  tabular: { fontVariant: ["tabular-nums"] },
});
