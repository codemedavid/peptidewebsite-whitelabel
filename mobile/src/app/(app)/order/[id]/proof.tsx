import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useOrder } from "@/features/orders/hooks";
import { SPACE, TOUCH } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * Full-screen payment proof. The image URL comes from the authenticated order
 * fetch — never from the route — so this screen can't be pointed elsewhere.
 * Pinch to zoom (iOS scroll-view zoom; Android shows it fitted).
 */
export default function ProofViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order } = useOrder(id ?? "");
  const { width, height } = useWindowDimensions();
  const url = order?.paymentProofUrl ?? null;

  return (
    <View style={styles.root}>
      <ScrollView
        maximumZoomScale={4}
        minimumZoomScale={1}
        centerContent
        contentContainerStyle={styles.center}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {url ? (
          <Image
            source={{ uri: url }}
            contentFit="contain"
            accessibilityLabel={`Payment proof for order ${order?.orderNumber ?? ""}`}
            style={{ width, height: height * 0.85 }}
          />
        ) : (
          <AppText variant="body" color="#fff">No payment proof on this order.</AppText>
        )}
      </ScrollView>
      <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={styles.close} hitSlop={8}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  top: { position: "absolute", top: 0, right: 0, left: 0, alignItems: "flex-end", padding: SPACE.md },
  close: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
});
