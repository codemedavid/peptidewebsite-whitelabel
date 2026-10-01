import { View } from "react-native";
import { useSignedIn } from "@/auth/SessionProvider";
import { openLink } from "../open";
import { CHAT } from "../theme";
import { ChatButton, ChatEmpty, type IconName } from "./ChatKit";
import { LargeHeader } from "./Headers";

/** Placeholder tab until phase 4 (Shop, My orders) lands. */
export function ComingSoon({ title, icon, heading, body }: { title: string; icon: IconName; heading: string; body: string }) {
  const { me } = useSignedIn();
  return (
    <View style={{ flex: 1, backgroundColor: CHAT.surface }}>
      <LargeHeader title={title} />
      <ChatEmpty
        icon={icon}
        title={heading}
        body={body}
        action={<ChatButton label={`Open ${me.store.name}`} icon="open-outline" tone="outline" onPress={() => void openLink(me.store.websiteUrl)} />}
      />
    </View>
  );
}
