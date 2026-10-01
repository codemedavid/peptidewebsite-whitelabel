import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText } from "./primitives";

// ── Text field: visible label, inline error, optional show/hide password ─────

type FieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  error?: string | null;
  hint?: string;
  password?: boolean;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, password, ...input },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? t.tone("danger").fg : focused ? t.brand.link : t.colors.border;

  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View style={[styles.box, { backgroundColor: t.colors.surface, borderColor, borderWidth: focused || error ? 2 : 1 }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={t.colors.textFaint}
          selectionColor={t.brand.link}
          secureTextEntry={password && !revealed}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, t.type.body, { color: t.colors.text }, input.multiline ? styles.multiline : null]}
          {...input}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            hitSlop={8}
            onPress={() => setRevealed((r) => !r)}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={20} color={t.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={15} color={t.tone("danger").fg} />
          <AppText variant="caption" color={t.tone("danger").fg}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" color="faint">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

// ── Segmented control (order filters) ───────────────────────────────────────

export type Segment<K extends string> = { key: K; label: string; count?: number };

export function Segmented<K extends string>({
  segments,
  value,
  onChange,
}: {
  segments: ReadonlyArray<Segment<K>>;
  value: K;
  onChange: (k: K) => void;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: t.colors.surfaceAlt }]}>
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={s.count ? `${s.label}, ${s.count}` : s.label}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(s.key);
            }}
            style={[styles.segment, active ? { backgroundColor: t.colors.surface, shadowOpacity: 0.08 } : null]}
          >
            <AppText variant="label" color={active ? "text" : "muted"} numberOfLines={1}>
              {s.label}
            </AppText>
            {s.count ? (
              <View style={[styles.badge, { backgroundColor: active ? t.brand.primary : t.colors.border }]}>
                <AppText variant="caption" color={active ? t.brand.onPrimary : t.colors.text} style={{ fontWeight: "700" }}>
                  {s.count > 99 ? "99+" : String(s.count)}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: TOUCH + 4, borderRadius: RADIUS.md, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  reveal: { paddingHorizontal: SPACE.md, height: TOUCH, justifyContent: "center" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  segmented: { flexDirection: "row", borderRadius: RADIUS.md, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: RADIUS.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0,
  },
  badge: { minWidth: 22, paddingHorizontal: 6, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
});
