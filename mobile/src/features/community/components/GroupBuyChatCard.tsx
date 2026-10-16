// The live group-buy round shared into chat. The server rebuilds it from the
// live round on every load, so an old message still shows today's slots and
// countdown — and reads "ended" once the round is over.
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GroupBuyCard } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { roundUrgency, slotMeter } from "@/features/shop/lib/group-buy";
import { groupBuyBand, ImageStack, LiveDot, SlotBar, URGENCY_COLOR } from "@/features/shop/components/group-buy/GroupBuyParts";
import { useNow } from "../hooks/useMotion";
import { CHAT, INTER, RADII } from "../theme";
import { ChatText } from "./ChatText";

const WIDTH = 268;
const MINUTE = 60_000;

/** Customers land on the shop's group-buy screen; the team on its store preview of it. */
export function useOpenGroupBuy(): () => void {
  const { me } = useSignedIn();
  return () => router.push(me.mode === "customer" ? "/group-buy" : "/storefront-group-buy");
}

export function GroupBuyChatCard({ round, onLongPress }: { round: GroupBuyCard | null; onLongPress?: () => void }) {
  const { me } = useSignedIn();
  const openRound = useOpenGroupBuy();
  const now = useNow(MINUTE);
  if (!round) {
    return (
      <View style={{ width: WIDTH, padding: 14, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="eye-off-outline" size={18} color={CHAT.inkMuted} />
        <ChatText variant="footnote">This group buy is no longer available.</ChatText>
      </View>
    );
  }

  const band = groupBuyBand(me.theme.primary);
  const urgency = roundUrgency(round.endsAt, now);
  const ended = round.status === "ended" || urgency.ended;
  const paused = round.status === "closed";
  const meter = slotMeter(round.slotGoal, round.filled);
  const status = ended ? "Ended" : paused ? "Ordering paused" : urgency.label;
  const cta = ended ? "See what's in the shop" : paused ? "View the round" : "Join the group buy";
  const details = [round.fromPriceLabel ? `From ${round.fromPriceLabel}` : null, round.productCount ? `${round.productCount} ${round.productCount === 1 ? "item" : "items"}` : null]
    .filter(Boolean)
    .join(" · ");
  const open = ended ? () => router.push(me.mode === "customer" ? "/shop" : "/storefront") : openRound;
  const colors = ended ? (["#4A4D55", "#2C2E33"] as const) : ([band.top, band.bottom] as const);

  return (
    <Pressable
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityLabel={[`Group buy ${round.name}`, status, !ended && meter.enabled ? meter.label : null, details].filter(Boolean).join(", ")}
      accessibilityHint={cta}
      style={({ pressed }) => ({ width: WIDTH, borderRadius: RADII.md, overflow: "hidden", opacity: pressed ? 0.92 : 1 })}
    >
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 13, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginLeft: -5 }}>
            <LiveDot live={!ended && !paused} size={7} />
            <ChatText variant="overline" style={{ color: band.text }}>
              Group buy
            </ChatText>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: band.chip }}>
            <Ionicons name={ended ? "lock-closed" : paused ? "pause" : "time-outline"} size={11} color={ended || paused ? band.muted : URGENCY_COLOR[urgency.tone]} />
            <ChatText allowFontScaling={false} style={{ fontFamily: INTER.semibold, fontSize: 11, lineHeight: 14, color: ended || paused ? band.muted : URGENCY_COLOR[urgency.tone] }}>
              {status}
            </ChatText>
          </View>
        </View>

        <ChatText numberOfLines={2} style={{ fontFamily: INTER.bold, fontSize: 19, lineHeight: 24, color: band.text }}>
          {round.name}
        </ChatText>

        {!ended ? (
          <>
            {round.images.length || details ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ImageStack images={round.images} size={30} ring={band.top} />
                <ChatText variant="subhead" numberOfLines={1} style={{ color: band.text, flex: 1 }}>
                  {details}
                </ChatText>
              </View>
            ) : null}
            {meter.enabled ? (
              <View style={{ gap: 5 }}>
                <SlotBar meter={meter} fill={band.fill} track={band.track} height={6} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <ChatText variant="caption" style={{ color: band.text }}>
                    {meter.label}
                  </ChatText>
                  <ChatText variant="caption" style={{ color: band.muted }}>
                    {meter.hint}
                  </ChatText>
                </View>
              </View>
            ) : meter.filled > 0 ? (
              <ChatText variant="caption" style={{ color: band.muted }}>
                {meter.filled} already joined
              </ChatText>
            ) : null}
            {round.deliveryEta ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Ionicons name="cube-outline" size={13} color={band.muted} />
                <ChatText variant="caption" numberOfLines={1} style={{ color: band.muted, flex: 1 }}>
                  Ships {round.deliveryEta}
                </ChatText>
              </View>
            ) : null}
          </>
        ) : (
          <ChatText variant="footnote" style={{ color: band.muted }}>
            This round has closed. Watch the chat for the next one.
          </ChatText>
        )}
      </LinearGradient>
      <View
        style={{
          height: 44,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: CHAT.surface,
          borderWidth: 1,
          borderTopWidth: 0,
          borderColor: CHAT.hairline,
          borderBottomLeftRadius: RADII.md,
          borderBottomRightRadius: RADII.md,
        }}
      >
        <Ionicons name={ended ? "bag-handle-outline" : "people"} size={16} color={ended ? CHAT.inkMuted : CHAT.ink} />
        <ChatText variant="bodyStrong" style={{ fontSize: 14, color: ended ? CHAT.inkMuted : CHAT.ink }}>
          {cta}
        </ChatText>
      </View>
    </Pressable>
  );
}

/**
 * The Chats list's pinned row while a round is live: one tap into the round.
 * Moderators also get "Send to all" (the broadcast form).
 */
export function GroupBuyPin({ round, canBroadcast }: { round: GroupBuyCard; canBroadcast: boolean }) {
  const { me } = useSignedIn();
  const openRound = useOpenGroupBuy();
  const now = useNow(MINUTE);
  const band = groupBuyBand(me.theme.primary);
  const urgency = roundUrgency(round.endsAt, now);
  if (round.status === "ended" || urgency.ended) return null;
  const paused = round.status === "closed";
  const meter = slotMeter(round.slotGoal, round.filled);
  const line = [paused ? "Ordering paused" : urgency.label, meter.enabled ? meter.hint : null].filter(Boolean).join(" · ");
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
      <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: RADII.lg, flexDirection: "row", alignItems: "center" }}>
        <Pressable
          onPress={openRound}
          accessibilityRole="button"
          accessibilityLabel={`Live group buy ${round.name}, ${line}`}
          accessibilityHint="Opens the group buy"
          style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingLeft: 12, paddingRight: 8, opacity: pressed ? 0.85 : 1 })}
        >
          <ImageStack images={round.images.slice(0, 3)} size={34} ring={band.top} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginLeft: -6 }}>
              <LiveDot live={!paused} size={6} />
              <ChatText numberOfLines={1} style={{ fontFamily: INTER.bold, fontSize: 14.5, lineHeight: 19, color: band.text, flexShrink: 1 }}>
                {round.name}
              </ChatText>
            </View>
            <ChatText variant="caption" numberOfLines={1} style={{ color: paused ? band.muted : URGENCY_COLOR[urgency.tone] }}>
              {line}
            </ChatText>
          </View>
          {!canBroadcast ? <Ionicons name="chevron-forward" size={18} color={band.muted} /> : null}
        </Pressable>
        {canBroadcast && !paused ? (
          <Pressable
            onPress={() => router.push("/community/group-buy-broadcast")}
            accessibilityRole="button"
            accessibilityLabel="Send the group buy to everyone"
            hitSlop={4}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 12, marginRight: 10, borderRadius: 17, backgroundColor: pressed ? "rgba(255,255,255,0.85)" : band.text })}
          >
            <Ionicons name="megaphone" size={14} color={band.bottom} />
            <ChatText style={{ fontFamily: INTER.semibold, fontSize: 13, lineHeight: 16, color: band.bottom }}>Send to all</ChatText>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}
