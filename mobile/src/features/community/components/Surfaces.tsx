import { memo, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useReducedMotion } from "../hooks/useMotion";
import { CHAT, GRADIENTS, GUTTER, INTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { CountBadge, IconButton, type IconName } from "./ChatKit";

// ── Sheet ────────────────────────────────────────────────────────────────────

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  contentStyle?: ViewStyle;
  /** Hug the content (action menus) instead of taking most of the screen. */
  fit?: boolean;
  /** iOS: fires once the sheet is fully gone — safe to present another modal. */
  onDismiss?: () => void;
};

/** Native page-sheet on iOS for tall content, a bottom sheet everywhere else. */
export function Sheet({ visible, onClose, title, subtitle, children, contentStyle, fit = false, onDismiss }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const pageSheet = Platform.OS === "ios" && !fit;
  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      onDismiss={onDismiss}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle={pageSheet ? "pageSheet" : "overFullScreen"}
      transparent={!pageSheet}
    >
      {!pageSheet ? (
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" style={{ flex: 1, backgroundColor: CHAT.scrim }} />
      ) : null}
      <View
        accessibilityViewIsModal
        style={[
          {
            backgroundColor: CHAT.canvas,
            flex: pageSheet ? 1 : undefined,
            maxHeight: pageSheet ? undefined : "90%",
            borderTopLeftRadius: pageSheet ? 0 : RADII.xl,
            borderTopRightRadius: pageSheet ? 0 : RADII.xl,
            paddingBottom: pageSheet ? 0 : insets.bottom + 8,
            overflow: "hidden",
          },
          contentStyle,
        ]}
      >
        <View style={{ alignItems: "center", paddingTop: 8 }}>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: CHAT.hairlineStrong }} />
        </View>
        {title ? (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 12, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <ChatText variant="title" accessibilityRole="header" style={{ fontSize: 19 }}>
                {title}
              </ChatText>
              {subtitle ? <ChatText variant="footnote">{subtitle}</ChatText> : null}
            </View>
            <IconButton name="close" label="Close" size={36} iconSize={20} onPress={onClose} />
          </View>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}

// ── Wallpaper ────────────────────────────────────────────────────────────────

const GLYPHS: IconName[] = ["flask-outline", "sparkles-outline", "heart-outline", "leaf-outline", "chatbubble-outline", "bag-handle-outline", "flash-outline", "star-outline"];
const COLS = 6;
const ROWS = 14;
const CELL = 72;

/** Telegram-style chat wallpaper: a soft gradient with a faint doodle pattern. Static and memoised. */
export const Wallpaper = memo(function Wallpaper() {
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => i);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[...GRADIENTS.wallpaper]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { flexDirection: "row", flexWrap: "wrap", opacity: 0.07 }]}>
        {cells.map((i) => {
          const row = Math.floor(i / COLS);
          return (
            <View
              key={i}
              style={{
                width: CELL,
                height: CELL,
                alignItems: "center",
                justifyContent: "center",
                transform: [{ translateX: row % 2 ? CELL / 2 : 0 }, { rotate: `${((i * 37) % 50) - 25}deg` }],
              }}
            >
              <Ionicons name={GLYPHS[(i * 5 + row) % GLYPHS.length]} size={22} color="#5B2440" />
            </View>
          );
        })}
      </View>
    </View>
  );
});

// ── Segmented tabs (chat folders) ────────────────────────────────────────────

export type SegmentItem<T extends string> = { key: T; label: string; count?: number };

/** Telegram-style chat folders: text tabs with an underline and unread counts. */
export function SegmentedTabs<T extends string>({ items, value, onChange }: { items: SegmentItem<T>[]; value: T; onChange: (key: T) => void }) {
  const b = useChatBrand();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: CHAT.hairline, backgroundColor: CHAT.surface }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={{ paddingHorizontal: GUTTER - 4 }}>
        {items.map((item) => {
          const active = item.key === value;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.count ? `${item.label}, ${item.count}` : item.label}
              style={{ paddingHorizontal: 10, paddingTop: 12, alignItems: "center", minHeight: 44 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 10 }}>
                <ChatText
                  style={{ fontFamily: active ? INTER.bold : INTER.medium, fontSize: 14.5, lineHeight: 19, color: active ? b.brandText : CHAT.inkMuted }}
                >
                  {item.label}
                </ChatText>
                {item.count ? <CountBadge count={item.count} muted={!active} /> : null}
              </View>
              <View style={{ height: 3, alignSelf: "stretch", borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: active ? b.brand : "transparent" }} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
