import { Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { formatClock } from "../lib/format";
import { CHAT, INTER, RADII, SHADOWS, type ChatBrand } from "../theme";
import { ChatText } from "./ChatText";

type Props = {
  message: CommunityMessage;
  brand: ChatBrand;
  onLongPress?: (m: CommunityMessage) => void;
};

/**
 * The order bot's status update (server: lib/community/order-bot.ts). Centred
 * like a system line — it's the store's automatic voice, not a person — with
 * the update text and a way into the order: the team opens the admin order,
 * the buyer opens their own order page.
 */
export function OrderUpdateCard({ message, brand, onLongPress }: Props) {
  const { me } = useSignedIn();
  const order = message.order;
  const deleted = !!message.deletedAt;
  const isTeam = me.mode === "admin";
  const canOpen = !!order && !deleted && (!isTeam || me.can.orders);

  const open = () => {
    if (!order) return;
    if (isTeam) router.push({ pathname: "/order/[id]", params: { id: order.id } });
    else router.push({ pathname: "/my-order/[number]", params: { number: order.number } });
  };

  return (
    <Pressable
      onLongPress={!deleted && onLongPress ? () => onLongPress(message) : undefined}
      delayLongPress={280}
      accessibilityLabel={`Order update: ${deleted ? "deleted" : (message.body ?? "")}`}
      style={[
        {
          alignSelf: "center",
          width: "88%",
          maxWidth: 420,
          marginVertical: 10,
          backgroundColor: CHAT.surface,
          borderRadius: RADII.lg,
          overflow: "hidden",
          borderLeftWidth: 4,
          borderLeftColor: brand.brand,
        },
        SHADOWS.card,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, backgroundColor: brand.brandTint }}>
        <Ionicons name="hardware-chip-outline" size={14} color={brand.brandText} />
        <ChatText style={{ fontFamily: INTER.semibold, fontSize: 12.5, lineHeight: 16, color: brand.brandText, letterSpacing: 0.3, textTransform: "uppercase" }}>
          Order updates · bot
        </ChatText>
        <ChatText style={{ marginLeft: "auto", fontSize: 11, lineHeight: 13, color: CHAT.inkMuted, fontFamily: INTER.medium }}>
          {formatClock(message.createdAt)}
        </ChatText>
      </View>

      <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        {deleted ? (
          <ChatText style={{ fontSize: 15, lineHeight: 20, fontStyle: "italic", color: CHAT.inkMuted }}>Update deleted</ChatText>
        ) : (
          <ChatText selectable style={{ fontSize: 15, lineHeight: 21, color: CHAT.ink }}>
            {message.body ?? ""}
          </ChatText>
        )}
      </View>

      {canOpen ? (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`View order ${order!.number}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 11,
            borderTopWidth: 1,
            borderTopColor: CHAT.hairline,
            backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
          })}
        >
          <ChatText style={{ fontFamily: INTER.semibold, fontSize: 14.5, lineHeight: 19, color: brand.brandText }}>View order</ChatText>
          <Ionicons name="chevron-forward" size={15} color={brand.brandText} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
