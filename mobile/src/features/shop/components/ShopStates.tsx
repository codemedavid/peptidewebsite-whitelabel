import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ApiError } from "@/api/client";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";

/** Full-screen states for the shop: private store, store not found, generic error. */

export function goToSignIn() {
  router.push("/sign-in");
}

export function PrivateStore({ storeName }: { storeName: string }) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <View style={[styles.icon, { backgroundColor: t.colors.surfaceAlt }]}>
        <Ionicons name="lock-closed-outline" size={28} color={t.colors.textMuted} />
      </View>
      <AppText variant="title" style={styles.text} accessibilityRole="header">
        This store is private
      </AppText>
      <AppText variant="body" color="muted" style={styles.text}>
        {`${storeName} shares its catalog with members only. Sign in with your ${storeName} account to shop.`}
      </AppText>
      <Button label="Sign in to shop" icon="log-in-outline" onPress={goToSignIn} style={styles.cta} />
    </View>
  );
}

/** Any catalog failure, in the words that fit it. */
export function CatalogError({ error, storeName, onRetry }: { error: Error; storeName: string; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === "forbidden") return <PrivateStore storeName={storeName} />;
  if (error instanceof ApiError && error.code === "not_found") {
    return <EmptyState icon="storefront-outline" title="This shop isn't open in the app" body={`${storeName} isn't taking app orders right now. Try again later, or shop on their website.`} action={{ label: "Try again", onPress: onRetry }} />;
  }
  return <ErrorState message={error.message} onRetry={onRetry} />;
}

/** The owner closed the shop: browse only. */
export function ClosedBanner({ message }: { message: string }) {
  const t = useTheme();
  const c = t.tone("warning");
  return (
    <View accessibilityRole="summary" style={[styles.closed, { backgroundColor: c.bg }]}>
      <Ionicons name="moon-outline" size={20} color={c.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong" color={c.fg}>
          The shop is closed right now
        </AppText>
        <AppText variant="caption" color={c.fg}>
          {message || "You can look around, but orders are paused until the store reopens."}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.xxl, gap: SPACE.md, minHeight: 360 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: SPACE.xs },
  text: { textAlign: "center", maxWidth: 320 },
  cta: { marginTop: SPACE.md, alignSelf: "stretch" },
  closed: { flexDirection: "row", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, alignItems: "flex-start" },
});
