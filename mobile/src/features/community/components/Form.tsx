import { forwardRef, useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CHAT, INTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import type { IconName } from "./ChatKit";

type FieldProps = TextInputProps & {
  label?: string;
  icon?: IconName;
  hint?: string;
  /** Show a live "12/60" counter when maxLength is set. */
  counter?: boolean;
};

/** Labelled input with a brand focus ring. */
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, icon, hint, counter = false, multiline, style, ...input }, ref) {
  const b = useChatBrand();
  const [focused, setFocused] = useState(false);
  const length = typeof input.value === "string" ? input.value.length : 0;
  return (
    <View style={{ gap: 6 }}>
      {label || (counter && input.maxLength) ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 2 }}>
          {label ? <ChatText variant="overline">{label}</ChatText> : <View />}
          {counter && input.maxLength ? <ChatText variant="caption">{`${length}/${input.maxLength}`}</ChatText> : null}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: multiline ? "flex-start" : "center",
          gap: 10,
          backgroundColor: CHAT.surface,
          borderWidth: 1.5,
          borderColor: focused ? b.brand : CHAT.hairlineStrong,
          borderRadius: RADII.md,
          paddingHorizontal: 14,
          minHeight: 50,
          paddingVertical: multiline ? 12 : 0,
        }}
      >
        {icon ? <Ionicons name={icon} size={18} color={focused ? b.brandText : CHAT.inkMuted} style={{ marginTop: multiline ? 2 : 0 }} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label ?? input.placeholder}
          {...input}
          multiline={multiline}
          placeholderTextColor={CHAT.inkFaint}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              fontFamily: INTER.regular,
              fontSize: 15.5,
              color: CHAT.ink,
              minHeight: multiline ? 64 : 48,
              textAlignVertical: multiline ? "top" : "center",
              paddingVertical: 0,
            },
            style,
          ]}
        />
      </View>
      {hint ? (
        <ChatText variant="footnote" style={{ marginHorizontal: 2 }}>
          {hint}
        </ChatText>
      ) : null}
    </View>
  );
});

/** A white form card with an overline title. */
export function FormCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <ChatText variant="overline" accessibilityRole="header" style={{ marginLeft: 4 }}>
          {title}
        </ChatText>
      ) : null}
      <View style={{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 14, gap: 14 }}>{children}</View>
    </View>
  );
}

/** A pick-one emoji grid for channel and topic icons. */
export function EmojiGrid({ options, value, onChange }: { options: string[]; value: string; onChange: (emoji: string) => void }) {
  const b = useChatBrand();
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((e) => {
        const active = value === e;
        return (
          <Pressable
            key={e}
            onPress={() => onChange(e)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Icon ${e}`}
            style={({ pressed }) => ({
              width: 46,
              height: 46,
              borderRadius: RADII.md,
              backgroundColor: active ? b.brandSoft : pressed ? CHAT.surfacePressed : CHAT.surfaceAlt,
              borderWidth: 2,
              borderColor: active ? b.brand : "transparent",
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            <ChatText allowFontScaling={false} style={{ fontSize: 22, lineHeight: 28 }}>
              {e}
            </ChatText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A large radio option (who can post, etc). */
export function RadioOption({ icon, title, body, active, onPress }: { icon: IconName; title: string; body: string; active: boolean; onPress: () => void }) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${title}. ${body}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: RADII.md,
        borderWidth: 1.5,
        borderColor: active ? b.brand : CHAT.hairline,
        backgroundColor: active ? b.brandTint : CHAT.surface,
      }}
    >
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: active ? b.brand : CHAT.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={active ? b.onBrand : CHAT.inkMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <ChatText variant="bodyStrong">{title}</ChatText>
        <ChatText variant="footnote">{body}</ChatText>
      </View>
      <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={22} color={active ? b.brandText : CHAT.inkFaint} />
    </Pressable>
  );
}

/** Inline error line under a form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <ChatText variant="subhead" accessibilityLiveRegion="polite" color={CHAT.danger}>
      {message}
    </ChatText>
  );
}
