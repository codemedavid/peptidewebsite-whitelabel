/**
 * A horizontally scrolling row of protocol chips, each with its colour dot
 * (the same dot as Today and the calendar), plus an optional "All". Used by
 * the Calendar filter and the level-chart picker.
 */
import { Pressable, ScrollView, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Protocol } from "../../lib/types";
import { Dot, haptic, TText } from "../kit";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "../theme";

type Props = {
  protocols: readonly Protocol[];
  /** null = "All". */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Spoken group name ("Show one protocol"). */
  label: string;
  hasAll?: boolean;
  /** Marks protocols that can't be shown yet (e.g. no half-life) with a small hint icon. */
  isMuted?: (p: Protocol) => boolean;
};

export function ProtocolChips({ protocols, value, onChange, label, hasAll, isMuted }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {hasAll ? <ProtocolChip name="All" isSelected={value === null} onPress={() => onChange(null)} /> : null}
      {protocols.map((p) => (
        <ProtocolChip
          key={p.id}
          name={p.name}
          color={p.color}
          isSelected={value === p.id}
          isMuted={isMuted?.(p) ?? false}
          isEnded={p.status === "archived"}
          onPress={() => onChange(p.id)}
        />
      ))}
    </ScrollView>
  );
}

function ProtocolChip({
  name,
  color,
  isSelected,
  isMuted,
  isEnded,
  onPress,
}: {
  name: string;
  color?: string;
  isSelected: boolean;
  isMuted?: boolean;
  isEnded?: boolean;
  onPress: () => void;
}) {
  const th = useTrackerTheme();
  const fg = isSelected ? th.onBrand : th.ink;
  const spoken = `${name}${isEnded ? ", ended" : ""}${isMuted ? ", no half-life yet" : ""}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={spoken}
      accessibilityState={{ checked: isSelected }}
      onPress={() => {
        if (isSelected) return;
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: isSelected ? th.brand : th.surface, borderColor: isSelected ? th.brand : th.line },
        pressed && !isSelected ? { backgroundColor: th.surfaceAlt } : null,
      ]}
    >
      {color ? <Dot color={color} size={10} ring={isSelected ? th.onBrand : undefined} /> : null}
      <TText variant="meta" color={fg} numberOfLines={1} style={styles.name}>
        {name}
      </TText>
      {isMuted ? <Ionicons name="add-circle-outline" size={14} color={isSelected ? th.onBrand : th.inkFaint} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: TSPACE.sm, paddingRight: TSPACE.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: TOUCH_MIN,
    paddingHorizontal: 14,
    borderRadius: TRADIUS.pill,
    borderWidth: 1,
  },
  name: { maxWidth: 160 },
});
