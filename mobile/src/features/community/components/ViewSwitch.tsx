import { Pressable } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSwitchView } from "../useAppView";
import { CHAT, INTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

/** Community view → back to the business app. Sits top-right on every community tab. */
export function BusinessSwitch() {
  const b = useChatBrand();
  const switchView = useSwitchView();
  return (
    <Pressable
      onPress={() => switchView("business")}
      accessibilityRole="button"
      accessibilityLabel="Switch to business view"
      accessibilityHint="Back to orders, products and your store tools"
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: pressed ? b.brandEdge : CHAT.hairlineStrong,
        backgroundColor: pressed ? b.brandSoft : CHAT.surface,
      })}
    >
      <Ionicons name="briefcase-outline" size={16} color={b.brandText} />
      <ChatText style={{ fontFamily: INTER.semibold, fontSize: 14, lineHeight: 18 }} color={b.brandText}>
        Business
      </ChatText>
    </Pressable>
  );
}
