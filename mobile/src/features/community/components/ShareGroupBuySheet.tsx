import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useInbox } from "../hooks/useInbox";
import { avatarColors, hueFromString } from "../lib/color";
import { initials } from "../lib/format";
import { shareTargets, type ShareTarget } from "../lib/group-buy";
import { newClientId } from "../lib/messages";
import { useBlocked } from "../lib/safety";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatEmpty } from "./ChatKit";
import { Sheet } from "./Surfaces";

type Props = { visible: boolean; roundId: string; roundName: string; onClose: () => void };

/** "Share in a chat": drop the live round's card into any chat you can post in, then open that chat. */
export function ShareGroupBuySheet({ visible, roundId, roundName, onClose }: Props) {
  const b = useChatBrand();
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const inbox = useInbox();
  const safety = useBlocked();
  const targets = useMemo(() => shareTargets(inbox.data, safety.blocked), [inbox.data, safety.blocked]);
  const [sending, setSending] = useState<string | null>(null);

  const share = async (target: ShareTarget) => {
    if (sending) return;
    setSending(target.id);
    try {
      await communityApi.send(target.type, target.id, { clientId: newClientId(), kind: "groupbuy", groupBuyId: roundId });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: qk.communityInbox(scope) });
      void qc.invalidateQueries({ queryKey: qk.communityThread(scope, target.type, target.id) });
      onClose();
      router.push({ pathname: target.type === "dm" ? "/community/dm/[id]" : "/community/topic/[id]", params: { id: target.id } });
    } catch (e) {
      Alert.alert("Not shared", e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setSending(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Share the group buy" subtitle={`${roundName} lands as a card anyone can join from`}>
      {inbox.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 32 }} accessibilityLabel="Loading chats" />
      ) : inbox.error && !inbox.data ? (
        <ChatEmpty icon="cloud-offline-outline" title="Couldn't load your chats" body={inbox.error.message} />
      ) : (
        <FlatList
          data={targets}
          keyExtractor={(t) => `${t.type}-${t.id}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListEmptyComponent={<ChatEmpty icon="chatbubbles-outline" title="No chats to share to yet" body="Join a channel or message someone first." />}
          renderItem={({ item }) => {
            const busy = sending === item.id;
            const avatar = avatarColors(hueFromString(item.peerKey ?? item.title));
            return (
              <Pressable
                onPress={() => void share(item)}
                disabled={!!sending}
                accessibilityRole="button"
                accessibilityLabel={`Share to ${item.title}`}
                accessibilityState={{ busy, disabled: !!sending && !busy }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: GUTTER,
                  paddingVertical: 10,
                  minHeight: 60,
                  backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
                  borderBottomWidth: 1,
                  borderBottomColor: CHAT.hairline,
                  opacity: sending && !busy ? 0.5 : 1,
                })}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: item.type === "dm" ? 21 : 12,
                    backgroundColor: item.type === "dm" ? avatar.bg : b.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ChatText style={{ fontSize: item.type === "dm" ? 15 : 20, color: item.type === "dm" ? avatar.fg : CHAT.ink }}>
                    {item.type === "dm" ? initials(item.title) : (item.emoji ?? "💬")}
                  </ChatText>
                </View>
                <View style={{ flex: 1 }}>
                  <ChatText variant="bodyStrong" numberOfLines={1}>
                    {item.title}
                  </ChatText>
                  <ChatText variant="footnote" numberOfLines={1}>
                    {item.type === "dm" ? "Direct message" : "Channel"}
                  </ChatText>
                </View>
                {busy ? <ActivityIndicator color={b.brandText} /> : <Ionicons name="paper-plane" size={20} color={b.brandText} />}
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}
