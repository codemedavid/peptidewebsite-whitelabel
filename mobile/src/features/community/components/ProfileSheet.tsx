import { Alert, View } from "react-native";
import type { Participant } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useOpenDm, useProfileOf } from "../hooks/useCommunityData";
import { firstName, memberSince } from "../lib/format";
import { CHAT, GUTTER, RADII, useChatBrand } from "../theme";
import { ParticipantAvatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton } from "./ChatKit";
import { Sheet } from "./Surfaces";

type Props = {
  /** Who to show; null keeps it closed. What the bubble already knows renders at once. */
  person: Participant | null;
  /** The DM being viewed, so "Message" just closes the sheet. */
  currentConversationPeer?: string;
  /** Set when opened from a group message: quote it in the group's composer. */
  onReplyInGroup?: () => void;
  onClose: () => void;
};

/**
 * A member's card (tap an avatar or name in a chat). From a group message it
 * offers both ways to answer, WhatsApp-style: reply in the group, or chat
 * privately. Elsewhere it's just "Message <name>".
 */
export function ProfileSheet({ person, currentConversationPeer, onReplyInGroup, onClose }: Props) {
  const b = useChatBrand();
  const { me } = useSignedIn();
  const details = useProfileOf(person?.key ?? null);
  const openDm = useOpenDm();
  const isMe = !!person && person.key === me.community.myKey;
  const inThisDm = !!person && person.key === currentConversationPeer;
  const joined = memberSince(details.data?.memberSince ?? null);
  const shortName = person ? (person.isTeam ? person.name : firstName(person.name)) : "";

  const message = () => {
    if (!person) return;
    if (inThisDm) {
      onClose();
      return;
    }
    openDm.mutate(person.key, {
      onSuccess: onClose,
      onError: (e) => Alert.alert("Couldn't open the chat", e.message),
    });
  };

  const replyInGroup = () => {
    if (!onReplyInGroup) return;
    onClose();
    onReplyInGroup();
  };

  return (
    <Sheet visible={person != null} onClose={onClose} fit>
      {person ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 16, gap: 16 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <ParticipantAvatar person={person} size={84} />
            <ChatText variant="title" numberOfLines={1} accessibilityRole="header" style={{ marginTop: 6 }}>
              {person.name}
              {isMe ? <ChatText variant="title" color={CHAT.inkMuted}> (you)</ChatText> : null}
            </ChatText>
            {person.isTeam ? (
              <ChatText variant="footnote" color={b.brandText}>
                Store team
              </ChatText>
            ) : joined ? (
              <ChatText variant="footnote">{`Member since ${joined}`}</ChatText>
            ) : null}
          </View>
          {details.data?.bio ? (
            <View style={{ backgroundColor: CHAT.surface, borderRadius: RADII.md, padding: 12, gap: 2 }}>
              <ChatText variant="caption">About</ChatText>
              <ChatText variant="callout">{details.data.bio}</ChatText>
            </View>
          ) : null}
          {isMe ? null : (
            <View style={{ gap: 10 }}>
              {onReplyInGroup ? (
                <ChatButton
                  label="Reply in community"
                  size="lg"
                  pill
                  tone="tinted"
                  icon="arrow-undo"
                  accessibilityLabel={`Reply to ${person.name}'s message in the community`}
                  onPress={replyInGroup}
                />
              ) : null}
              <ChatButton
                label={onReplyInGroup ? `Chat privately with ${shortName}` : `Message ${shortName}`}
                size="lg"
                pill
                icon={onReplyInGroup ? "lock-closed" : "chatbubble-ellipses"}
                loading={openDm.isPending}
                accessibilityLabel={`Send ${person.name} a private message`}
                onPress={message}
              />
              {onReplyInGroup ? (
                <ChatText variant="footnote" style={{ textAlign: "center" }}>
                  Private chats are only seen by the two of you.
                </ChatText>
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}
