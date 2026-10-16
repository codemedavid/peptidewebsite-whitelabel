import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The guest shop: a signed-out phone linked to a store that runs the customer
 * app browses its catalog and fills a cart here. Checkout sends them to
 * sign-in (the root layout guards this group; see app/_layout.tsx).
 */
export default function GuestLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.brand.headerBackground },
        headerTintColor: t.brand.headerText,
        headerTitleStyle: { color: t.brand.headerText, fontFamily: t.font.sansSemi },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="product/[id]" options={{ title: "" }} />
      <Stack.Screen name="group-buy" options={{ title: "Group buy" }} />
      <Stack.Screen name="cart" options={{ title: "Cart" }} />
    </Stack>
  );
}
