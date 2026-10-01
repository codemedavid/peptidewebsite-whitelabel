import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ProductCard, ProductRow } from "@contract";
import type { ShopProduct } from "@shop-contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useProducts } from "@/features/products/hooks";
import { useCatalog } from "@/features/shop/hooks";
import { money } from "@/features/shop/lib/money";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatEmpty, SearchBar } from "./ChatKit";
import { ProductImage } from "./Media";
import { Sheet } from "./Surfaces";

// The server rebuilds the real card from its own data when the message is
// sent; these only drive the composer preview.

/** A store-team catalog row as a chat card. */
export function cardFromRow(row: ProductRow): ProductCard {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.imageUrl,
    price: 0,
    priceLabel: row.priceLabel,
    variationId: null,
    variationName: null,
    hasVariations: row.hasVariations,
    inStock: row.stockTone !== "out" && row.available,
    stockLeft: row.stock,
  };
}

/** A shop listing (what customers see) as a chat card. */
export function cardFromShop(p: ShopProduct, currency: string): ProductCard {
  return {
    id: p.id,
    name: p.name,
    imageUrl: p.image,
    price: p.price,
    priceLabel: money(p.price, currency),
    variationId: null,
    variationName: null,
    hasVariations: p.variations.length > 0,
    inStock: p.purchasable,
    stockLeft: p.stock,
  };
}

type PickRow = { card: ProductCard; detail: string };

/**
 * What this person may share: customers pick from the shop they browse, the
 * store team from its own catalog. Each source only loads for its audience.
 */
function usePickRows(visible: boolean) {
  const { me } = useSignedIn();
  const customer = me.mode === "customer";
  const products = useProducts({ enabled: visible && !customer });
  const catalog = useCatalog();
  const source = customer ? catalog : products;
  const rows = useMemo<PickRow[]>(() => {
    if (customer) {
      const c = catalog.data;
      if (!c) return [];
      return c.products.map((p) => {
        const card = cardFromShop(p, c.store.currency);
        const stock = !p.purchasable ? (p.badge ?? "Sold out") : p.stock !== null ? `${p.stock} left` : "";
        return { card, detail: [card.priceLabel, stock].filter(Boolean).join(" · ") };
      });
    }
    return (products.data?.products ?? []).map((row) => ({
      card: cardFromRow(row),
      detail: `${row.priceLabel}${row.stockTone === "out" ? " · Sold out" : row.stock !== null ? ` · ${row.stock} in stock` : ""}`,
    }));
  }, [customer, catalog.data, products.data]);
  return { rows, isPending: source.isPending, error: source.error };
}

type Props = { visible: boolean; title?: string; subtitle?: string; onClose: () => void; onPick: (p: ProductCard) => void };

/** Pick one of the store's products to share into chat. */
export function ProductPicker({ visible, title = "Share a product", subtitle = "It lands in the chat as a listing anyone can open", onClose, onPick }: Props) {
  const b = useChatBrand();
  const products = usePickRows(visible);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? products.rows.filter((p) => p.card.name.toLowerCase().includes(needle)) : products.rows;
  }, [products.rows, q]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 10 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="Search products" />
      </View>
      {products.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 32 }} accessibilityLabel="Loading products" />
      ) : products.error ? (
        <ChatEmpty icon="cloud-offline-outline" title="Couldn't load products" body={products.error.message} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.card.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
          ListEmptyComponent={<ChatEmpty icon="pricetags-outline" title="No products" body={q ? `Nothing matches “${q.trim()}”.` : undefined} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onPick(item.card);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Share ${item.card.name}, ${item.detail}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: GUTTER,
                paddingVertical: 10,
                backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
                borderBottomWidth: 1,
                borderBottomColor: CHAT.hairline,
              })}
            >
              <ProductImage uri={item.card.imageUrl} name={item.card.name} width={52} height={52} radius={10} />
              <View style={{ flex: 1, gap: 2 }}>
                <ChatText variant="bodyStrong" numberOfLines={1}>
                  {item.card.name}
                </ChatText>
                <ChatText variant="footnote" numberOfLines={1}>
                  {item.detail}
                </ChatText>
              </View>
              <Ionicons name="add-circle" size={24} color={b.brandText} />
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}
