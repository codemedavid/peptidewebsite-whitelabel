import { Pressable } from "react-native";
import { router } from "expo-router";
import { useSignedIn } from "@/auth/SessionProvider";
import { Avatar } from "@/features/community/components/Avatar";
import { ChatsScreen } from "@/features/community/components/ChatsScreen";

/** Your own avatar, top-right — like the inspiration, it opens Me. */
function MeButton() {
  const { me } = useSignedIn();
  const profile = me.community.profile;
  const name = profile?.displayName || me.actor.displayName;
  return (
    <Pressable onPress={() => router.navigate("/me")} accessibilityRole="button" accessibilityLabel="Your profile" hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Avatar name={name} hue={profile?.avatarHue ?? 0} size={34} />
    </Pressable>
  );
}

/** Customer app: Chats (members only — guarded in the tab layout). */
export default function CustomerChatsTab() {
  return <ChatsScreen headerRight={<MeButton />} />;
}
