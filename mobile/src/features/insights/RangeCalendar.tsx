import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { daysInMonth, keyOf, mondayIndex, MONTHS_LONG, parseKey } from "./dates";

// Month grid for picking a custom date range: first tap sets the start, the
// second the end (an earlier day restarts the range). Days after `max`
// (store today) are disabled — there are no sales from the future.

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const CELL = 44;

type Props = {
  from: string | null;
  to: string | null;
  max: string;
  onChange: (from: string | null, to: string | null) => void;
};

export function RangeCalendar({ from, to, max, onChange }: Props) {
  const t = useTheme();
  const start = parseKey(to ?? from ?? max) ?? parseKey(max)!;
  const [view, setView] = useState({ y: start.y, m: start.m });
  const maxYmd = parseKey(max)!;
  const atMax = view.y > maxYmd.y || (view.y === maxYmd.y && view.m >= maxYmd.m);

  const shift = (by: number) => {
    const total = view.y * 12 + view.m + by;
    setView({ y: Math.floor(total / 12), m: total % 12 });
  };
  const tapDay = (key: string) => {
    void Haptics.selectionAsync().catch(() => undefined);
    if (!from || (from && to) || key < from) onChange(key, null);
    else onChange(from, key);
  };

  const lead = mondayIndex(view.y, view.m, 1);
  const count = daysInMonth(view.y, view.m);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => keyOf({ y: view.y, m: view.m, d: i + 1 })),
  ];

  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => shift(-1)} style={styles.nav}>
          <Ionicons name="chevron-back" size={20} color={t.colors.text} />
        </Pressable>
        <AppText variant="bodyStrong" accessibilityRole="header">{`${MONTHS_LONG[view.m]} ${view.y}`}</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: atMax }}
          disabled={atMax}
          hitSlop={10}
          onPress={() => shift(1)}
          style={[styles.nav, atMax ? { opacity: 0.3 } : null]}
        >
          <Ionicons name="chevron-forward" size={20} color={t.colors.text} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {WEEK.map((w, i) => (
          <View key={`w${i}`} style={styles.cell}>
            <AppText variant="caption" color="faint">{w}</AppText>
          </View>
        ))}
        {cells.map((key, i) => {
          if (!key) return <View key={`e${i}`} style={styles.cell} />;
          const disabled = key > max;
          const edge = key === from || key === to;
          const inside = Boolean(from && to && key > from && key < to);
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key}
              accessibilityState={{ disabled, selected: edge || inside }}
              disabled={disabled}
              onPress={() => tapDay(key)}
              style={[styles.cell, inside ? { backgroundColor: t.colors.surfaceAlt } : null]}
            >
              <View style={[styles.day, edge ? { backgroundColor: t.colors.text } : null]}>
                <AppText
                  variant="label"
                  color={edge ? t.colors.bg : disabled ? "faint" : "text"}
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {String(parseKey(key)!.d)}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  nav: { width: CELL, height: CELL, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: CELL, alignItems: "center", justifyContent: "center" },
  day: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
});
