import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { ShopProduct } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { cardPrice, isSoldOut } from "../lib/catalog";
import { Badge, PriceTag, ProductImage } from "./ShopUI";

type Props = {
  product: ShopProduct;
  currency: string;
  width: number;
  onPress: (id: string) => void;
};

/** One grid tile: photo, badges, name, price (with the "was" price when marked down). */
export const ProductCard = memo(function ProductCard({ product, currency, width, onPress }: Props) {
  const t = useTheme();
  const soldOut = isSoldOut(product);
  const price = cardPrice(product);
  const status = soldOut ? "Sold out" : !product.purchasable ? "Unavailable" : product.isGroupBuy ? "Group buy" : "";
  const a11y = [product.name, status, product.badge && product.badge !== status ? product.badge : ""].filter(Boolean).join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the product"
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress(product.id);
      }}
      style={({ pressed }) => [
        styles.card,
        { width, backgroundColor: t.colors.surface, borderColor: t.colors.border },
        pressed ? styles.pressed : null,
      ]}
    >
      <View>
        <ProductImage uri={product.image} width={width} style={[styles.image, { height: width }, soldOut ? styles.dim : null]} />
        <View style={styles.badges} pointerEvents="none">
          {soldOut ? (
            <Badge tone="neutral" label="Sold out" />
          ) : product.isGroupBuy ? (
            <Badge tone="brand" label="Group buy" icon="people" />
          ) : product.badge ? (
            <Badge tone={/off|sale/i.test(product.badge) ? "danger" : "neutral"} label={product.badge} />
          ) : null}
        </View>
      </View>
      <View style={styles.body}>
        <AppText variant="label" numberOfLines={2} style={styles.name}>
          {product.name}
        </AppText>
        <PriceTag price={price.price} compareAtPrice={price.compareAtPrice} currency={currency} from={price.from} />
        {!soldOut && !product.purchasable ? (
          <AppText variant="caption" color="muted" numberOfLines={1}>
            Not available right now
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  image: { width: "100%" },
  dim: { opacity: 0.55 },
  badges: { position: "absolute", top: SPACE.sm, left: SPACE.sm, right: SPACE.sm, flexDirection: "row", gap: 4 },
  body: { padding: SPACE.md, gap: SPACE.xs },
  name: { minHeight: 38 },
});
