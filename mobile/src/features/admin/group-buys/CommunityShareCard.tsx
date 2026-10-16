import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useLiveGroupBuy } from "@/features/community/hooks/useCommunityData";
import { communityAccess } from "@/features/community/lib/access";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button } from "@/ui/primitives";

/**
 * Group Buys → Rounds: while a round is open, one tap sends it to the
 * community (or previews it the way shoppers see it). Moderators only.
 */
export function CommunityShareCard() {
  const t = useTheme();
  const { me } = useSignedIn();
  const moderator = communityAccess(me).moderator;
  const live = useLiveGroupBuy(moderator);
  const round = live.data?.groupBuy;
  if (!moderator || !round || round.status !== "open") return null;
  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: t.brand.primary }]}>
          <Ionicons name="megaphone" size={18} color={t.brand.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{round.name} is live</AppText>
          <AppText variant="caption" color="muted">
            Post it in your community chats and notify every member at once.
          </AppText>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label="Preview" variant="secondary" icon="eye-outline" onPress={() => router.push("/storefront-group-buy")} style={{ flex: 1 }} />
        <Button label="Send to everyone" icon="paper-plane" onPress={() => router.push("/community/group-buy-broadcast")} style={{ flex: 1.4 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACE.lg, gap: SPACE.md },
  head: { flexDirection: "row", gap: SPACE.md, alignItems: "center" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: SPACE.sm },
});
