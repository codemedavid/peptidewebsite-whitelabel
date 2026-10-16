import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { SignUpGender } from "@contract";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { GENDER_OPTIONS } from "./rules";

const PILL_HEIGHT = 40;

type GenderChoiceProps = {
  value: SignUpGender | null;
  onChange: (gender: SignUpGender | null) => void;
  accent: string;
};

/** Optional gender as a radio group of wrapping pills; "Prefer not to say" is the default. */
export function GenderChoice({ value, onChange, accent }: GenderChoiceProps) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">
        Gender (optional)
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel="Gender (optional)" style={styles.row}>
        {GENDER_OPTIONS.map((o) => {
          const selected = o.key === value;
          return (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (selected) return;
                void Haptics.selectionAsync().catch(() => undefined);
                onChange(o.key);
              }}
              style={({ pressed }) => [
                styles.pill,
                {
                  borderColor: selected ? accent : t.colors.border,
                  backgroundColor: selected ? withAlpha(accent, 0.12) : t.colors.surfaceAlt,
                },
                pressed && !selected ? { opacity: 0.7 } : null,
              ]}
            >
              <AppText variant="label" color={selected ? accent : t.colors.textMuted}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  pill: {
    minHeight: PILL_HEIGHT,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
