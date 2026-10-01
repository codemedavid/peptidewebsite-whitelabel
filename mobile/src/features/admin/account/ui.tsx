import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import type { Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import type { PayChannel } from "./rules";

/** Small building blocks shared by the Team & account screens. */

const tap = () => void Haptics.selectionAsync().catch(() => undefined);

/** A tinted callout (the website's admin__tip / success / danger boxes). */
export function Notice({ tone = "info", icon, children }: { tone?: Tone; icon?: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]} accessibilityLiveRegion="polite">
      {icon ? <Ionicons name={icon} size={18} color={c.fg} style={{ marginTop: 2 }} /> : null}
      <View style={{ flex: 1 }}>
        {typeof children === "string" ? (
          <AppText variant="caption" color={c.fg}>
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** A labelled checkbox row (permission grid, "Select all"). */
export function CheckRow({ checked, label, onPress, disabled }: { checked: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.check,
        { borderColor: checked ? t.brand.link : t.colors.border, backgroundColor: checked ? t.colors.surfaceAlt : t.colors.surface },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? t.brand.link : t.colors.textMuted} />
      <AppText variant="label" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** A radio row with optional body shown under it (payment method / Starter combo). */
export function RadioRow({
  selected,
  title,
  sub,
  onPress,
  children,
}: {
  selected: boolean;
  title: string;
  sub?: string;
  onPress: () => void;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      onPress={() => {
        if (selected) return;
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.radio,
        { borderColor: selected ? t.brand.link : t.colors.border, backgroundColor: t.colors.surface },
        pressed && !selected ? { opacity: 0.7 } : null,
      ]}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? t.brand.link : t.colors.textMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {sub ? (
          <AppText variant="caption" color="muted">
            {sub}
          </AppText>
        ) : null}
        {children}
      </View>
    </Pressable>
  );
}

/** A QR / receipt thumbnail. */
export function Thumb({ uri, label, size = 96 }: { uri: string; label: string; size?: number }) {
  const t = useTheme();
  return (
    <Image
      source={{ uri }}
      style={[styles.thumb, { width: size, height: size, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }]}
      contentFit="contain"
      accessibilityLabel={label}
    />
  );
}

/** One of the platform's receiving accounts: name, account · number, note, QR. */
export function PayChannelRow({ channel }: { channel: PayChannel }) {
  const t = useTheme();
  const details = [channel.account, channel.number].filter(Boolean).join(" · ") || "—";
  return (
    <View style={[styles.channel, { borderColor: t.colors.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{channel.method}</AppText>
        <AppText variant="caption" color="muted" selectable>
          {details}
        </AppText>
        {channel.note.trim() ? (
          <AppText variant="caption" color="muted">
            {channel.note}
          </AppText>
        ) : null}
      </View>
      {channel.qrUrl ? <Thumb uri={channel.qrUrl} label={`${channel.method} QR code`} size={80} /> : null}
    </View>
  );
}

/** "Label ........ value" money line (order summary / amount due). */
export function MoneyLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: Tone }) {
  const t = useTheme();
  const color = tone ? t.tone(tone).fg : "text";
  return (
    <View style={styles.money} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant={strong ? "bodyStrong" : "body"} color={strong ? "text" : "muted"} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? "stat" : "bodyStrong"} color={color}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.md },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    minHeight: TOUCH,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  radio: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md, borderWidth: 1 },
  thumb: { borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth },
  channel: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  money: { flexDirection: "row", alignItems: "baseline", gap: SPACE.md },
});
