import { useCallback, useMemo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopProduct } from "@shop-contract";
import { ProductCard } from "@/features/shop/components/ProductCard";
import { useCatalog } from "@/features/shop/hooks";
import { railProducts } from "@/features/shop/lib/catalog";
import { useShop } from "@/features/shop/ShopProvider";
import { CHAT, GUTTER, INTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

const TILE = 136;

/**
 * "From the shop" — a swipeable row of the store's buyable products at the top
 * of Chats, so members see what's for sale without leaving the community.
 * Taps open the product in whichever shop is mounted (member: the real shop;
 * admin community view: the read-only preview). Stays out of the way: nothing
 * renders while loading, on error, with no shop, or with nothing to buy.
 */
export function ShopRail({ seeAllHref }: { seeAllHref?: Href }) {
  const b = useChatBrand();
  const shop = useShop();
  const q = useCatalog();
  const products = useMemo(() => (q.data ? railProducts(q.data.products) : []), [q.data]);
  const open = useCallback((id: string) => router.push(shop.paths.product(id)), [shop.paths]);

  if (shop.mode === "off" || !q.data || products.length === 0) return null;
  const currency = q.data.store.currency;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: CHAT.hairline, paddingTop: 12, paddingBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER, marginBottom: 10 }}>
        <ChatText variant="overline" accessibilityRole="header" style={{ flex: 1 }}>
          From the shop
        </ChatText>
        <Pressable
          onPress={() => router.navigate(seeAllHref ?? shop.paths.home)}
          accessibilityRole="button"
          accessibilityLabel="See all products"
          hitSlop={8}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 2, opacity: pressed ? 0.6 : 1 })}
        >
          <ChatText style={{ fontFamily: INTER.semibold, fontSize: 14, lineHeight: 18 }} color={b.brandText}>
            See all
          </ChatText>
          <Ionicons name="chevron-forward" size={16} color={b.brandText} />
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={products}
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 10 }}
        renderItem={({ item }: { item: ShopProduct }) => <ProductCard product={item} currency={currency} width={TILE} onPress={open} />}
      />
    </View>
  );
}
