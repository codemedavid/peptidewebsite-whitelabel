// Product drops: the night-panel card in chat, the pinned bar above a thread,
// and the story circle on the Chats rail.
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityDrop } from "@contract";
import { useNow } from "../hooks/useMotion";
import { formatCountdown, splitCountdown } from "../lib/format";
import { CHAT, GRADIENTS, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatButton } from "./ChatKit";
import { stockCopy, useOpenProduct } from "./Cards";
import { ProductImage } from "./Media";

const CARD_W = 292;

const isClosed = (drop: CommunityDrop, now: number) =>
  !drop.isActive || (drop.expiresAt !== null && Date.parse(drop.expiresAt) <= now) || !drop.product.inStock;

/** Ticking "02 : 14 : 33" boxes (a day box once more than 24h remain). */
export function Countdown({ until }: { until: string }) {
  const now = useNow(1000);
  const parts = splitCountdown(until, now);
  if (!parts) {
    return <ChatText variant="subhead" color="#fff">Ended</ChatText>;
  }
  const boxes = parts.days > 0 ? [`${parts.days}d`, parts.hours, parts.minutes] : [parts.hours, parts.minutes, parts.seconds];
  return (
    <View accessible accessibilityLabel={`Ends in ${formatCountdown(until, now) ?? "under a minute"}`} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {boxes.map((value, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {i > 0 ? <ChatText allowFontScaling={false} style={{ color: "#fff", fontFamily: INTER.bold, fontSize: 12.5, lineHeight: 16 }}>:</ChatText> : null}
          <View style={{ minWidth: 26, height: 22, paddingHorizontal: 3, borderRadius: 4, backgroundColor: "rgba(15,17,21,0.62)", alignItems: "center", justifyContent: "center" }}>
            <ChatText allowFontScaling={false} style={{ color: "#fff", fontFamily: INTER.bold, fontSize: 12.5, lineHeight: 16, fontVariant: ["tabular-nums"] }}>
              {value}
            </ChatText>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The full drop card, as it lands in a chat: premium night panel, one big CTA. */
export function DropCard({ drop, onEnd }: { drop: CommunityDrop; onEnd?: () => void }) {
  const now = useNow(30_000);
  const openProduct = useOpenProduct();
  const closed = isClosed(drop, now);
  const { product } = drop;
  const openStore = () => openProduct(product.id);
  return (
    <View style={[{ width: CARD_W, borderRadius: RADII.lg, overflow: "hidden" }, SHADOWS.float]}>
      <LinearGradient colors={[...GRADIENTS.night]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <View>
          <ProductImage uri={product.imageUrl} name={product.name} width={CARD_W} height={164} radius={0} />
          <LinearGradient colors={["transparent", "rgba(27,15,22,0.95)"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90 }} />
          <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: closed ? "rgba(15,17,21,0.7)" : CHAT.heat, paddingHorizontal: 9, height: 24, borderRadius: 12 }}>
            <Ionicons name={closed ? "lock-closed" : "flash"} size={12} color="#fff" />
            <ChatText allowFontScaling={false} style={{ color: "#fff", fontFamily: INTER.bold, fontSize: 11, lineHeight: 13, letterSpacing: 0.4 }}>
              {closed ? "DROP ENDED" : "LIVE DROP"}
            </ChatText>
          </View>
          {drop.expiresAt && !closed ? (
            <View style={{ position: "absolute", top: 10, right: 10 }}>
              <Countdown until={drop.expiresAt} />
            </View>
          ) : null}
          <ChatText variant="title" color="#fff" numberOfLines={2} style={{ position: "absolute", left: 14, right: 14, bottom: 10, fontSize: 19 }}>
            {drop.headline}
          </ChatText>
        </View>
        <View style={{ padding: 14, gap: 12 }}>
          <View>
            <ChatText variant="subhead" color="rgba(255,255,255,0.8)" numberOfLines={1}>
              {product.name}
              {product.variationName ? ` · ${product.variationName}` : ""}
            </ChatText>
            <ChatText style={{ color: "#fff", fontFamily: INTER.bold, fontSize: 22, lineHeight: 28 }}>{product.priceLabel}</ChatText>
            <ChatText variant="footnote" color="rgba(255,255,255,0.8)">
              {stockCopy(product)}
            </ChatText>
          </View>
          {drop.note ? (
            <ChatText variant="callout" color="rgba(255,255,255,0.86)">
              {drop.note}
            </ChatText>
          ) : null}
          <ChatButton label={closed ? "Drop ended" : "Buy now"} disabled={closed} onPress={openStore} icon={closed ? undefined : "flash"} />
          {onEnd && drop.isActive ? (
            <Pressable onPress={onEnd} hitSlop={12} accessibilityRole="button" accessibilityLabel="End this drop" style={{ alignSelf: "center", minHeight: 32, justifyContent: "center" }}>
              <ChatText variant="footnote" color="rgba(255,255,255,0.7)">
                End this drop · team
              </ChatText>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

/** Telegram's pinned-message bar: the live drop above a chat. */
export function DropPinnedBar({ drop }: { drop: CommunityDrop }) {
  const now = useNow(30_000);
  const openProduct = useOpenProduct();
  const openStore = () => openProduct(drop.product.id);
  const closed = isClosed(drop, now);
  const countdown = drop.expiresAt ? formatCountdown(drop.expiresAt, now) : null;
  const openChat = () => router.push({ pathname: "/community/topic/[id]", params: { id: drop.topicId } });
  return (
    <Pressable
      onPress={openChat}
      accessibilityRole="button"
      accessibilityLabel={`Pinned drop: ${drop.headline}, ${drop.product.priceLabel}${countdown ? `, ends in ${countdown}` : ""}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 10,
        backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
        borderBottomWidth: 1,
        borderBottomColor: CHAT.hairline,
      })}
    >
      <View style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: closed ? CHAT.inkFaint : CHAT.heat }} />
      <ProductImage uri={drop.product.imageUrl} name={drop.product.name} width={36} height={36} radius={6} />
      <View style={{ flex: 1 }}>
        <ChatText variant="caption" color={closed ? CHAT.inkMuted : CHAT.heat} style={{ fontFamily: INTER.bold }}>
          {closed ? "Drop ended" : countdown ? `⚡ Pinned drop · ends in ${countdown}` : "⚡ Pinned drop"}
        </ChatText>
        <ChatText variant="subhead" numberOfLines={1} style={{ color: CHAT.ink }}>
          {`${drop.headline} · ${drop.product.priceLabel} · ${stockCopy(drop.product)}`}
        </ChatText>
      </View>
      {!closed ? <ChatButton label="Buy" size="sm" onPress={openStore} /> : null}
    </Pressable>
  );
}

/** Story circle for the Chats rail; opens the chat where the drop was announced. */
export function DropStory({ drop }: { drop: CommunityDrop }) {
  const b = useChatBrand();
  const now = useNow(60_000);
  const closed = isClosed(drop, now);
  const low = !closed && drop.product.stockLeft !== null && drop.product.stockLeft <= 10;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/community/topic/[id]", params: { id: drop.topicId } })}
      accessibilityRole="button"
      accessibilityLabel={`Drop: ${drop.headline}${closed ? ", ended" : ""}`}
      style={({ pressed }) => ({ width: 72, alignItems: "center", gap: 5, opacity: pressed ? 0.8 : 1 })}
    >
      <LinearGradient
        colors={closed ? [CHAT.hairlineStrong, CHAT.hairlineStrong] : [CHAT.heat, b.brand]}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={{ width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
          <ProductImage uri={drop.product.imageUrl} name={drop.product.name} width={56} height={56} radius={28} />
        </View>
      </LinearGradient>
      {low ? (
        <View style={{ position: "absolute", top: 50, backgroundColor: CHAT.heat, paddingHorizontal: 5, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: "#fff", justifyContent: "center" }}>
          <ChatText allowFontScaling={false} style={{ color: "#fff", fontFamily: INTER.bold, fontSize: 9, lineHeight: 11 }}>
            {`${drop.product.stockLeft} LEFT`}
          </ChatText>
        </View>
      ) : null}
      <ChatText variant="caption" numberOfLines={1} style={{ color: CHAT.ink, maxWidth: 72 }}>
        {drop.headline}
      </ChatText>
    </Pressable>
  );
}
