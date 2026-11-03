import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { LiveVisitor } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { shortAgo, STAGE_META } from "./stage";

function detailLine(v: LiveVisitor): string {
  const items = v.cartItems > 0 ? `${v.cartItems} ${v.cartItems === 1 ? "item" : "items"}` : null;
  switch (v.stage) {
    case "checkout":
      return ["Checking out", items, v.cartLabel].filter(Boolean).join(" · ");
    case "cart":
      return ["In the cart", items, v.cartLabel].filter(Boolean).join(" · ");
    case "product":
      return v.productName ? `Viewing ${v.productName}` : "Viewing a product";
    default:
      return items ? `Browsing · ${items} in cart` : "Browsing";
  }
}

/** One person on the store. `elapsed` = seconds since the snapshot was taken. */
export function VisitorRow({ visitor: v, elapsed }: { visitor: LiveVisitor; elapsed: number }) {
  const t = useTheme();
  const meta = STAGE_META[v.stage];
  const tone = t.tone(meta.tone);
  const hot = v.stage === "checkout";
  const name = v.who ?? "Visitor";
  const where = v.place ?? "Unknown location";
  const detail = detailLine(v);
  const onFor = shortAgo(v.onSiteSecs + elapsed);

  return (
    <View
      accessible
      accessibilityLabel={`${name}, ${where}, on the ${v.surface === "app" ? "app" : "website"}. ${detail}. Here for ${onFor}.`}
      style={[styles.row, hot ? { backgroundColor: tone.bg, borderColor: t.brand.link } : { borderColor: "transparent" }]}
    >
      <View style={[styles.icon, { backgroundColor: hot ? t.colors.surface : tone.bg }]}>
        <Ionicons name={meta.icon} size={18} color={tone.fg} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="label" numberOfLines={1} style={{ fontWeight: "600" }}>
          {`${name} · ${where}`}
        </AppText>
        <AppText variant="caption" color={hot ? tone.fg : "muted"} numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <View style={styles.side}>
        <View style={[styles.surface, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}>
          <Ionicons name={v.surface === "app" ? "phone-portrait-outline" : "globe-outline"} size={11} color={t.colors.textMuted} />
          <AppText variant="caption" color="muted" style={styles.surfaceText}>
            {v.surface === "app" ? "App" : "Web"}
          </AppText>
        </View>
        <AppText variant="caption" color="faint" style={styles.tabular}>
          {onFor}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  side: { alignItems: "flex-end", gap: 4 },
  surface: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  surfaceText: { fontSize: 11, lineHeight: 14 },
  tabular: { fontVariant: ["tabular-nums"] },
});
