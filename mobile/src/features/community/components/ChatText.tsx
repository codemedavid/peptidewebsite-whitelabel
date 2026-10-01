import { Text, type TextProps } from "react-native";
import { CHAT, CHAT_TYPE, type ChatTypeVariant } from "../theme";

export type ChatTextProps = TextProps & {
  variant?: ChatTypeVariant;
  color?: string;
};

const DEFAULT_COLOR: Partial<Record<ChatTypeVariant, string>> = {
  callout: CHAT.inkSoft,
  subhead: CHAT.inkSoft,
  footnote: CHAT.inkMuted,
  caption: CHAT.inkMuted,
  overline: CHAT.inkMuted,
};

/** Inter text for the chat surfaces; scales with the system font size (capped). */
export function ChatText({ variant = "body", color, style, ...rest }: ChatTextProps) {
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[CHAT_TYPE[variant], { color: color ?? DEFAULT_COLOR[variant] ?? CHAT.ink }, style]}
    />
  );
}
