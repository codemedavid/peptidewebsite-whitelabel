import { forwardRef, useEffect, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import type { IconName } from "@/ui/primitives";

const FIELD_HEIGHT = 60;
const LABEL_MS = 160;
const LABEL_SCALE = 0.76;
const LABEL_LIFT = -11;

type AuthFieldProps = Omit<TextInputProps, "style" | "placeholder"> & {
  label: string;
  icon: IconName;
  /** Focus colour — the screen's link colour. */
  focusColor: string;
  /** Red ring — the message itself is shown once, below the form. */
  invalid?: boolean;
  password?: boolean;
};

/**
 * The sign-in field: a tall filled box with a leading icon and a label that
 * rests inside as the placeholder, then floats up as you type (Material's
 * filled field, the iOS Settings feel). The label is always visible, so it
 * never vanishes the way a placeholder does once you start typing.
 */
export const AuthField = forwardRef<TextInput, AuthFieldProps>(function AuthField(
  { label, icon, focusColor, invalid, password, value, ...input },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const raised = focused || !!value;
  const [lift] = useState(() => new Animated.Value(raised ? 1 : 0));

  useEffect(() => {
    Animated.timing(lift, {
      toValue: raised ? 1 : 0,
      duration: LABEL_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [raised, lift]);

  const danger = t.tone("danger").fg;
  const accent = invalid ? danger : focusColor;
  const ring = invalid ? danger : focused ? focusColor : "transparent";
  const iconColor = invalid || focused ? accent : t.colors.textFaint;

  return (
    <View
      style={[
        styles.box,
        { backgroundColor: focused ? t.colors.surface : t.colors.surfaceAlt, borderColor: ring },
        focused ? { boxShadow: `0 0 0 4px ${withAlpha(accent, 0.14)}` } : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={iconColor} style={styles.icon} />
      <View style={styles.body}>
        <Animated.Text
          numberOfLines={1}
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={[
            styles.label,
            t.type.body,
            {
              color: invalid || focused ? accent : t.colors.textMuted,
              transform: [
                { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, LABEL_LIFT] }) },
                { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, LABEL_SCALE] }) },
              ],
            },
          ]}
        >
          {label}
        </Animated.Text>
        <TextInput
          ref={ref}
          value={value}
          accessibilityLabel={label}
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          selectionColor={focusColor}
          cursorColor={focusColor}
          secureTextEntry={password && !revealed}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, t.type.body, { color: t.colors.text }]}
          {...input}
        />
      </View>
      {password ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={revealed ? "Hide password" : "Show password"}
          hitSlop={10}
          onPress={() => {
            void Haptics.selectionAsync().catch(() => undefined);
            setRevealed((r) => !r);
          }}
          style={({ pressed }) => [styles.reveal, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={21} color={t.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    minHeight: FIELD_HEIGHT,
    borderRadius: RADIUS.lg + 4,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
  },
  icon: { marginLeft: SPACE.lg },
  body: { flex: 1, justifyContent: "center", alignSelf: "stretch" },
  label: { position: "absolute", pointerEvents: "none", left: SPACE.md, right: SPACE.sm, transformOrigin: "left center" },
  // The box draws the focus ring; outlineWidth: 0 drops the web preview's own.
  input: {
    paddingLeft: SPACE.md,
    paddingRight: SPACE.sm,
    paddingTop: 22,
    paddingBottom: 8,
    minHeight: FIELD_HEIGHT,
    outlineWidth: 0,
  },
  reveal: { width: 52, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
});
