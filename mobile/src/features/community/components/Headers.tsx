import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { IconButton } from "./ChatKit";

type LargeHeaderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  /** No bottom hairline when a tab strip follows. */
  flush?: boolean;
  /** Skip the status-bar inset (the tab navigator already draws a header). */
  noInset?: boolean;
};

/** Tab-root header: big bold title, actions right, a slot below (search). */
export function LargeHeader({ title, subtitle, right, children, flush = false, noInset = false }: LargeHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: (noInset ? 0 : insets.top) + 6,
        backgroundColor: CHAT.surface,
        borderBottomWidth: flush ? 0 : 1,
        borderBottomColor: CHAT.hairline,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, minHeight: 48, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <ChatText variant="largeTitle" accessibilityRole="header">
            {title}
          </ChatText>
          {subtitle ? <ChatText variant="footnote">{subtitle}</ChatText> : null}
        </View>
        {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>{right}</View> : null}
      </View>
      {children ? <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 12 }}>{children}</View> : <View style={{ height: 8 }} />}
    </View>
  );
}

type NavBarProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  /** Tapping the avatar-and-title block (WhatsApp's chat info). */
  onPressTitle?: () => void;
  titleHint?: string;
};

/** Pushed-screen bar: back chevron, avatar + two-line title (chat header). */
export function NavBar({ title, subtitle, leading, right, onBack, onPressTitle, titleHint }: NavBarProps) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  return (
    <View
      style={{
        paddingTop: insets.top + 4,
        paddingBottom: 8,
        paddingHorizontal: 6,
        backgroundColor: CHAT.surface,
        borderBottomWidth: 1,
        borderBottomColor: CHAT.hairline,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      <IconButton name="chevron-back" label="Back" iconSize={26} color={b.brandText} onPress={onBack ?? (() => router.back())} />
      {leading}
      <Pressable
        onPress={onPressTitle}
        disabled={!onPressTitle}
        accessibilityRole={onPressTitle ? "button" : "header"}
        accessibilityHint={onPressTitle ? titleHint : undefined}
        style={{ flex: 1, marginLeft: leading ? 4 : 0, minHeight: 44, justifyContent: "center" }}
      >
        <ChatText variant="headline" numberOfLines={1}>
          {title}
        </ChatText>
        {subtitle ? (
          <ChatText variant="footnote" numberOfLines={1}>
            {subtitle}
          </ChatText>
        ) : null}
      </Pressable>
      {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingRight: 4 }}>{right}</View> : null}
    </View>
  );
}

/** Form-sheet header: close left, centred title, primary action right. */
export function ModalHeader({ title, eyebrow, onClose, action }: { title: string; eyebrow?: string; onClose?: () => void; action?: ReactNode }) {
  const b = useChatBrand();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingTop: 14,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: CHAT.hairline,
        backgroundColor: CHAT.surface,
      }}
    >
      <View style={{ width: 96, alignItems: "flex-start" }}>
        <IconButton name="close" label="Close" onPress={onClose ?? (() => router.back())} />
      </View>
      <View style={{ flex: 1, alignItems: "center" }}>
        {eyebrow ? (
          <ChatText variant="caption" color={b.brandText} numberOfLines={1}>
            {eyebrow}
          </ChatText>
        ) : null}
        <ChatText variant="headline" numberOfLines={1} accessibilityRole="header">
          {title}
        </ChatText>
      </View>
      <View style={{ width: 96, alignItems: "flex-end", paddingRight: 8 }}>{action}</View>
    </View>
  );
}
