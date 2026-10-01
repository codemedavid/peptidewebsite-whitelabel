import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Pressable, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useReducedMotion } from "../hooks/useMotion";
import { CHAT, HIT, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

export type IconName = ComponentProps<typeof Ionicons>["name"];

const haptic = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

// ── Count badge ──────────────────────────────────────────────────────────────

export const BADGE_CAP = 99;

/** Unread count pill in the store's colour. Renders nothing for zero. */
export function CountBadge({ count, muted = false, ring = false }: { count: number; muted?: boolean; ring?: boolean }) {
  const b = useChatBrand();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={`${count} unread`}
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: muted ? CHAT.inkFaint : b.brand,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: ring ? 2 : 0,
        borderColor: "#fff",
      }}
    >
      <ChatText allowFontScaling={false} style={{ color: muted ? "#fff" : b.onBrand, fontSize: 11, lineHeight: 13, fontFamily: INTER.bold }}>
        {count > BADGE_CAP ? `${BADGE_CAP}+` : String(count)}
      </ChatText>
    </View>
  );
}

export function Dot({ size = 10 }: { size?: number }) {
  const b = useChatBrand();
  return <View accessibilityLabel="New" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: b.brand }} />;
}

// ── Icon button ──────────────────────────────────────────────────────────────

type IconButtonProps = {
  name: IconName;
  label: string;
  onPress?: () => void;
  variant?: "plain" | "tinted" | "overlay" | "brand";
  size?: number;
  iconSize?: number;
  badge?: number;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Round icon control; the hit area is always at least 44pt. */
export function IconButton({ name, label, onPress, variant = "plain", size = 40, iconSize = 22, badge = 0, color, disabled, style }: IconButtonProps) {
  const b = useChatBrand();
  const v = {
    plain: { bg: "transparent", pressed: CHAT.surfacePressed, fg: CHAT.ink },
    tinted: { bg: b.brandSoft, pressed: b.brandEdge, fg: b.brandText },
    overlay: { bg: "rgba(15,17,21,0.45)", pressed: "rgba(15,17,21,0.6)", fg: "#fff" },
    brand: { bg: b.brand, pressed: b.brandDeep, fg: b.onBrand },
  }[variant];
  const slop = Math.max(0, (HIT - size) / 2);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label}, ${badge}` : label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={slop}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: pressed ? v.pressed : v.bg,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={name} size={iconSize} color={color ?? v.fg} />
      {badge > 0 ? (
        <View style={{ position: "absolute", top: -3, right: -5 }}>
          <CountBadge count={badge} ring />
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonTone = "primary" | "tinted" | "dark" | "outline" | "ghost" | "danger";

type ChatButtonProps = {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  pill?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { sm: 36, md: 44, lg: 52 } as const;
const FONT = { sm: 13.5, md: 15, lg: 16 } as const;

export function ChatButton({ label, onPress, tone = "primary", size = "md", loading, disabled, icon, pill, accessibilityLabel, style }: ChatButtonProps) {
  const b = useChatBrand();
  const reduced = useReducedMotion();
  const t = {
    primary: { bg: b.brand, fg: b.onBrand, border: b.brand, pressed: b.brandDeep },
    tinted: { bg: b.brandSoft, fg: b.brandText, border: b.brandSoft, pressed: b.brandEdge },
    dark: { bg: CHAT.night, fg: "#fff", border: CHAT.night, pressed: CHAT.nightSoft },
    outline: { bg: CHAT.surface, fg: CHAT.ink, border: CHAT.hairlineStrong, pressed: CHAT.surfacePressed },
    ghost: { bg: "transparent", fg: CHAT.inkSoft, border: "transparent", pressed: CHAT.surfacePressed },
    danger: { bg: CHAT.dangerSoft, fg: CHAT.danger, border: CHAT.dangerSoft, pressed: "#F9D2D6" },
  }[tone];
  const inactive = !!(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={size === "sm" ? 4 : 0}
      onPress={() => {
        haptic();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: size === "sm" ? 12 : size === "md" ? 18 : 22,
          borderRadius: pill ? RADII.pill : size === "sm" ? RADII.sm : RADII.md,
          backgroundColor: pressed ? t.pressed : t.bg,
          borderWidth: 1,
          borderColor: t.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 7,
          opacity: inactive ? 0.45 : 1,
          transform: [{ scale: pressed && !reduced ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={t.fg} /> : icon ? <Ionicons name={icon} size={FONT[size] + 3} color={t.fg} /> : null}
      <ChatText variant="bodyStrong" numberOfLines={1} style={{ color: t.fg, fontSize: FONT[size], lineHeight: FONT[size] + 4 }}>
        {label}
      </ChatText>
    </Pressable>
  );
}

// ── Floating action button ───────────────────────────────────────────────────

export function Fab({ icon, label, onPress, bottom = 20 }: { icon: IconName; label: string; onPress: () => void; bottom?: number }) {
  const b = useChatBrand();
  const reduced = useReducedMotion();
  return (
    <Pressable
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          position: "absolute",
          right: 16,
          bottom,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: pressed ? b.brandDeep : b.brand,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: pressed && !reduced ? 0.94 : 1 }],
        },
        SHADOWS.float,
      ]}
    >
      <Ionicons name={icon} size={26} color={b.onBrand} />
    </Pressable>
  );
}

// ── Chip ─────────────────────────────────────────────────────────────────────

export function Chip({ label, active = false, icon, onPress }: { label: string; active?: boolean; icon?: IconName; onPress: () => void }) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        minHeight: 34,
        paddingHorizontal: 12,
        borderRadius: RADII.pill,
        borderWidth: 1,
        borderColor: active ? b.brand : CHAT.hairlineStrong,
        backgroundColor: active ? b.brandSoft : pressed ? CHAT.surfacePressed : CHAT.surface,
      })}
    >
      {icon ? <Ionicons name={icon} size={14} color={active ? b.brandText : CHAT.inkMuted} /> : null}
      <ChatText variant="subhead" style={{ color: active ? b.brandText : CHAT.inkSoft, fontFamily: active ? INTER.semibold : INTER.medium }}>
        {label}
      </ChatText>
    </Pressable>
  );
}

// ── Search field ─────────────────────────────────────────────────────────────

type SearchBarProps = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const SearchBar = forwardRef<TextInput, SearchBarProps>(function SearchBar({ value, onChangeText, placeholder, autoFocus, style }, ref) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 40,
          paddingHorizontal: 12,
          borderRadius: RADII.md,
          backgroundColor: CHAT.surfaceAlt,
          borderWidth: 1,
          borderColor: CHAT.hairline,
        },
        style,
      ]}
    >
      <Ionicons name="search" size={18} color={CHAT.inkMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={CHAT.inkFaint}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
        style={{ flex: 1, fontFamily: INTER.regular, fontSize: 15, color: CHAT.ink, paddingVertical: 8 }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={CHAT.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
});

// ── Empty state ──────────────────────────────────────────────────────────────

export function ChatEmpty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const b = useChatBrand();
  return (
    <View style={{ alignItems: "center", paddingVertical: 56, paddingHorizontal: 32, gap: 10 }}>
      <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: b.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: b.brandTint, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={icon} size={34} color={b.brandText} />
        </View>
      </View>
      <ChatText variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
        {title}
      </ChatText>
      {body ? (
        <ChatText variant="callout" style={{ textAlign: "center", color: CHAT.inkMuted, maxWidth: 300 }}>
          {body}
        </ChatText>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}
