import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button, Card, Pill } from "@/ui/primitives";
import { useInbox } from "./hooks/useInbox";
import { useSwitchView } from "./useAppView";

/** Home: what's waiting in the community, and one tap into the community view. */
export function CommunitySwitchCard() {
  const t = useTheme();
  const { me } = useSignedIn();
  const inbox = useInbox();
  const switchView = useSwitchView();
  const unread = inbox.data?.unreadChats ?? 0;
  const liveDrops = inbox.data?.drops.filter((d) => d.isActive).length ?? 0;
  const pending = me.community.pendingApplications;
  const quiet = !unread && !pending && !liveDrops;

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: t.brand.primary }]}>
          <Ionicons name="people" size={22} color={t.brand.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">Your community</AppText>
          <AppText variant="caption" color="muted">
            {quiet ? "Chat with members, run drops and approve new people." : "Members are waiting on you."}
          </AppText>
        </View>
      </View>
      {quiet ? null : (
        <View style={styles.pills}>
          {unread ? <Pill tone="info" size="sm" icon="chatbubbles-outline" label={`${unread > 99 ? "99+" : unread} unread`} /> : null}
          {pending ? <Pill tone="warning" size="sm" icon="person-add-outline" label={`${pending} to approve`} /> : null}
          {liveDrops ? <Pill tone="success" size="sm" icon="flash-outline" label={`${liveDrops} live ${liveDrops === 1 ? "drop" : "drops"}`} /> : null}
        </View>
      )}
      <Button
        label="Open community view"
        icon="swap-horizontal-outline"
        variant="secondary"
        accessibilityHint="Switches the app to your community. Tap Business there to come back."
        onPress={() => switchView("community")}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: SPACE.md },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  icon: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
});
