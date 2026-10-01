// Product and protocol cards shared into chat.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ProductCard, ProtocolCard } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useShop } from "@/features/shop/ShopProvider";
import { hueFromString } from "../lib/color";
import { openLink } from "../open";
import { CHAT, INTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import type { IconName } from "./ChatKit";
import { PhotoViewer, ProductImage } from "./Media";

const WIDTH = 240;

/** Stock words for a card — always words, never colour alone. */
export function stockCopy(p: Pick<ProductCard, "inStock" | "stockLeft">): string {
  if (!p.inStock) return "Sold out";
  if (p.stockLeft !== null && p.stockLeft <= 10) return `${p.stockLeft} left`;
  return "In stock";
}

/**
 * Open a shared product in the app: customers land on the shop's product page
 * (buy from there), the store team on its read-only store preview.
 */
export function useOpenProduct(): (productId: string) => void {
  const { me } = useSignedIn();
  const { paths } = useShop();
  return (productId: string) =>
    router.push(me.mode === "customer" ? paths.product(productId) : { pathname: "/storefront-product/[id]", params: { id: productId } });
}

/** A product someone shared into chat — Marketplace listing style. */
export function ProductChatCard({ product }: { product: ProductCard | null }) {
  const b = useChatBrand();
  const openProduct = useOpenProduct();
  if (!product) {
    return (
      <View style={{ width: WIDTH, padding: 14, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="eye-off-outline" size={18} color={CHAT.inkMuted} />
        <ChatText variant="footnote">This listing is no longer available.</ChatText>
      </View>
    );
  }
  const openStore = () => openProduct(product.id);
  const variant = product.variationName ? `${product.variationName} · ` : product.hasVariations ? "Several strengths · " : "";
  const low = product.inStock && product.stockLeft !== null && product.stockLeft <= 10;
  return (
    <View style={{ width: WIDTH, backgroundColor: CHAT.surface, borderRadius: RADII.md, overflow: "hidden", borderWidth: 1, borderColor: CHAT.hairline }}>
      <Pressable onPress={openStore} accessibilityRole="button" accessibilityLabel={`${product.name}, ${product.priceLabel}, ${stockCopy(product)}`} accessibilityHint="Opens the listing">
        <ProductImage uri={product.imageUrl} name={product.name} width={WIDTH} height={180} radius={0} />
        <View style={{ padding: 11, gap: 4 }}>
          <ChatText style={{ fontFamily: INTER.bold, fontSize: 17, lineHeight: 22, color: CHAT.ink }}>{product.priceLabel}</ChatText>
          <ChatText variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14, lineHeight: 19 }}>
            {product.name}
          </ChatText>
          <ChatText variant="footnote" numberOfLines={1} style={{ color: !product.inStock ? CHAT.danger : low ? CHAT.heat : CHAT.inkMuted }}>
            {`${variant}${stockCopy(product)}`}
          </ChatText>
        </View>
      </Pressable>
      <Pressable
        onPress={openStore}
        disabled={!product.inStock}
        accessibilityRole="button"
        accessibilityLabel={product.inStock ? `View ${product.name} in the store` : "Sold out"}
        style={({ pressed }) => ({
          height: 44,
          flexDirection: "row",
          gap: 6,
          alignItems: "center",
          justifyContent: "center",
          borderTopWidth: 1,
          borderTopColor: CHAT.hairline,
          backgroundColor: pressed ? b.brandTint : CHAT.surface,
          opacity: product.inStock ? 1 : 0.5,
        })}
      >
        <Ionicons name="bag-handle-outline" size={17} color={b.brandText} />
        <ChatText variant="bodyStrong" color={b.brandText} style={{ fontSize: 14 }}>
          {product.inStock ? "View in store" : "Sold out"}
        </ChatText>
      </Pressable>
    </View>
  );
}

function ProtocolRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 12, paddingVertical: 5 }}>
      <Ionicons name={icon} size={15} color={CHAT.inkMuted} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <ChatText variant="caption">{label}</ChatText>
        <ChatText variant="subhead" color={CHAT.ink} numberOfLines={2}>
          {value}
        </ChatText>
      </View>
    </View>
  );
}

/** A protocol shared into chat — a guide card; image/file guides open full screen / in the browser. */
export function ProtocolChatCard({ protocol }: { protocol: ProtocolCard | null }) {
  const b = useChatBrand();
  const [viewing, setViewing] = useState<string | null>(null);
  if (!protocol) {
    return (
      <View style={{ width: WIDTH, padding: 14, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Ionicons name="eye-off-outline" size={18} color={CHAT.inkMuted} />
        <ChatText variant="footnote">This protocol is no longer available.</ChatText>
      </View>
    );
  }
  const h = hueFromString(protocol.name);
  const open =
    protocol.mode === "image" && protocol.imageUrl
      ? () => setViewing(protocol.imageUrl)
      : protocol.mode === "file" && protocol.fileUrl
        ? () => void openLink(protocol.fileUrl!)
        : undefined;
  return (
    <>
      <Pressable
        onPress={open}
        disabled={!open}
        accessibilityRole={open ? "button" : undefined}
        accessibilityLabel={`${protocol.name} protocol`}
        accessibilityHint={open ? "Opens the guide" : undefined}
        style={({ pressed }) => ({ width: WIDTH, backgroundColor: CHAT.surface, borderRadius: RADII.md, overflow: "hidden", borderWidth: 1, borderColor: CHAT.hairline, opacity: pressed ? 0.9 : 1 })}
      >
        <LinearGradient colors={[`hsl(${h}, 62%, 94%)`, `hsl(${(h + 40) % 360}, 55%, 86%)`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 12, paddingTop: 11, paddingBottom: 12, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="clipboard" size={13} color={`hsl(${h}, 45%, 28%)`} />
            <ChatText variant="overline" style={{ color: `hsl(${h}, 45%, 28%)` }}>
              Protocol
            </ChatText>
          </View>
          <ChatText numberOfLines={2} style={{ fontFamily: INTER.bold, fontSize: 18, lineHeight: 23, color: CHAT.ink }}>
            {protocol.name}
          </ChatText>
        </LinearGradient>
        {protocol.mode === "text" ? (
          <View style={{ paddingVertical: 4 }}>
            <ProtocolRow icon="flask-outline" label="Dose" value={protocol.dose} />
            <ProtocolRow icon="repeat-outline" label="How often" value={protocol.frequency} />
            <ProtocolRow icon="calendar-outline" label="Cycle" value={protocol.cycle} />
          </View>
        ) : (
          <ProtocolRow
            icon={protocol.mode === "image" ? "image-outline" : "document-text-outline"}
            label="Guide"
            value={protocol.mode === "image" ? "Image guide" : "Downloadable guide"}
          />
        )}
        {open ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderTopWidth: 1, borderTopColor: CHAT.hairline }}>
            <Ionicons name="book-outline" size={16} color={b.brandText} />
            <ChatText variant="bodyStrong" color={b.brandText} style={{ fontSize: 14 }}>
              Read protocol
            </ChatText>
          </View>
        ) : null}
      </Pressable>
      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
