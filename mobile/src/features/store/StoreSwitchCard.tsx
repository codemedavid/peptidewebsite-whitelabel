import { ActivityIndicator, Alert, StyleSheet, Switch, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { storeApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { useOnline } from "@/ui/feedback";
import { AppText, Card, Pill } from "@/ui/primitives";

/**
 * The owner's shop switch (the website's Store Status). Closing asks first and
 * says exactly what customers will see; the switch waits for the server rather
 * than flipping optimistically, and is disabled offline.
 */
export function StoreSwitchCard({ open }: { open: boolean }) {
  const t = useTheme();
  const { scope } = useSignedIn();
  const online = useOnline();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (next: boolean) => storeApi.setOpen(next),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.dashboard(scope) }),
    onError: (e) => Alert.alert("Couldn't change your store", e.message),
  });

  function onToggle(next: boolean) {
    if (next) {
      m.mutate(true);
      return;
    }
    Alert.alert(
      "Close your store?",
      "Customers can still browse, but every buy button will say “Closed” until you reopen.",
      [
        { text: "Keep open", style: "cancel" },
        { text: "Close store", style: "destructive", onPress: () => m.mutate(false) },
      ],
    );
  }

  const shownOpen = m.isPending && m.variables !== undefined ? m.variables : open;
  return (
    <Card style={styles.card}>
      <View style={{ flex: 1, gap: 6 }}>
        <AppText variant="bodyStrong">Store is {shownOpen ? "open" : "closed"}</AppText>
        <Pill
          tone={shownOpen ? "success" : "warning"}
          icon={shownOpen ? "storefront-outline" : "moon-outline"}
          label={shownOpen ? "Taking orders" : "Not taking orders"}
          size="sm"
        />
      </View>
      {m.isPending ? (
        <ActivityIndicator color={t.brand.link} />
      ) : (
        <Switch
          accessibilityLabel="Store open"
          accessibilityHint={shownOpen ? "Closes your store to new orders" : "Opens your store"}
          value={shownOpen}
          disabled={!online}
          onValueChange={onToggle}
          trackColor={{ true: t.brand.primary, false: t.colors.border }}
          thumbColor="#FFFFFF"
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
