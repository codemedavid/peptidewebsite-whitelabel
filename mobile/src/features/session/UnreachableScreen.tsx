import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EmptyState } from "@/ui/feedback";
import { Button } from "@/ui/primitives";

/** A saved session, but no network and nothing cached to show yet. */
export function UnreachableScreen() {
  const t = useTheme();
  const { retry, signOut } = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <EmptyState
        icon="cloud-offline-outline"
        title="Can't reach your store"
        body="Either your internet is down or the store server is. Your sign-in is saved — nothing has been lost."
        action={{ label: "Try again", onPress: retry }}
      />
      <View style={{ padding: SPACE.xl }}>
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </SafeAreaView>
  );
}
