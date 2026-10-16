import { View } from "react-native";
import { router } from "expo-router";
import { COMMUNITY_RULES, useCommunityRules } from "../lib/safety";
import { GUTTER, RADII, CHAT } from "../theme";
import { ChatButton } from "./ChatKit";
import { ChatText } from "./ChatText";
import { Sheet } from "./Surfaces";

/**
 * The community's terms (App Store guideline 1.2): shown once per account on
 * this phone before the chats, and there is no way past it without agreeing.
 */
export function CommunityRules() {
  const { accepted, accept } = useCommunityRules();
  const leave = () => (router.canGoBack() ? router.back() : router.navigate("/"));
  return (
    <Sheet visible={accepted === false} onClose={leave} fit>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 16, gap: 14 }}>
        <ChatText variant="title" accessibilityRole="header">
          Community rules
        </ChatText>
        <ChatText variant="callout">
          Chats are shared with other members and the store team. There is zero tolerance for objectionable content or abusive people.
        </ChatText>
        <View style={{ backgroundColor: CHAT.surface, borderRadius: RADII.md, padding: 14, gap: 10 }}>
          {COMMUNITY_RULES.map((rule) => (
            <ChatText key={rule} variant="callout">{`•  ${rule}`}</ChatText>
          ))}
        </View>
        <ChatButton label="I agree" size="lg" pill onPress={accept} accessibilityLabel="Agree to the community rules" />
        <ChatButton label="Not now" size="lg" pill tone="ghost" onPress={leave} />
      </View>
    </Sheet>
  );
}
