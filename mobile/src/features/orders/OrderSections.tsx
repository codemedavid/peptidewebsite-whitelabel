import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderDetail } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Card, Divider, Pill, Row, SectionLabel } from "@/ui/primitives";
import { STATUS_META, formatFull } from "./status";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { useOpenDm } from "@/features/community/hooks/useCommunityData";

/** Presentational sections of the order detail screen. Props in, UI out. */

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  return [
    copied,
    (key, text) => {
      void Clipboard.setStringAsync(text);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    },
  ];
}

const digits = (phone: string) => phone.replace(/[^\d+]/g, "");

export function CustomerSection({ order }: { order: OrderDetail }) {
  const t = useTheme();
  const [copied, copy] = useCopy();
  const { name, phone, email, contactMethod } = order.customer;
  const { me } = useSignedIn();
  const openDm = useOpenDm();
  // The store ⇄ customer chat — where the order bot posts this order's updates.
  const canChat = !!order.chatKey && communityAccess(me).moderator;
  const messageCustomer = () => {
    if (!order.chatKey || openDm.isPending) return;
    openDm.mutate(order.chatKey, { onError: (e) => Alert.alert("Couldn't open the chat", e.message) });
  };
  return (
    <View>
      <SectionLabel>Customer</SectionLabel>
      <Card padded={false}>
        <Row icon="person-outline" label={name || "Customer"} detail={contactMethod ? `Prefers ${contactMethod}` : undefined} />
        {canChat ? (
          <>
            <Divider inset={62} />
            <Row
              icon="chatbubbles-outline"
              label="Message in app chat"
              detail="Order updates are posted here automatically"
              onPress={messageCustomer}
              trailing={<Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />}
            />
          </>
        ) : null}
        {phone ? (
          <>
            <Divider inset={62} />
            <Row
              icon="call-outline"
              label={phone}
              detail="Tap to call"
              onPress={() => void Linking.openURL(`tel:${digits(phone)}`)}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Text ${name || "the customer"}`}
                  hitSlop={10}
                  onPress={() => void Linking.openURL(`sms:${digits(phone)}`)}
                >
                  <Ionicons name="chatbubble-outline" size={20} color={t.brand.link} />
                </Pressable>
              }
            />
          </>
        ) : null}
        {email ? (
          <>
            <Divider inset={62} />
            <Row icon="mail-outline" label={email} detail="Tap to email" onPress={() => void Linking.openURL(`mailto:${email}`)} />
          </>
        ) : null}
        {order.shipping.addressLine ? (
          <>
            <Divider inset={62} />
            <Row
              icon="location-outline"
              label={order.shipping.addressLine}
              detail={copied === "booking" ? "Copied for your courier ✓" : "Tap to copy name, phone & address for booking"}
              onPress={() => copy("booking", order.shipping.bookingText)}
              trailing={<Ionicons name={copied === "booking" ? "checkmark" : "copy-outline"} size={18} color={t.colors.textFaint} />}
            />
          </>
        ) : null}
      </Card>
    </View>
  );
}

function MoneyLine({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={styles.moneyLine}>
      <AppText variant={strong ? "bodyStrong" : "body"} color={muted ? "muted" : "text"} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant={strong ? "heading" : "body"} color={muted ? "muted" : "text"} style={styles.tabular}>
        {value}
      </AppText>
    </View>
  );
}

export function ItemsSection({ order }: { order: OrderDetail }) {
  const m = order.money;
  return (
    <View>
      <SectionLabel>{`Items (${order.itemCount})`}</SectionLabel>
      <Card style={{ gap: SPACE.md }}>
        {order.items.map((i, idx) => (
          <View key={`${i.name}-${idx}`} style={styles.item}>
            <AppText variant="bodyStrong" style={styles.qty}>{`${i.qty}×`}</AppText>
            <View style={{ flex: 1 }}>
              <AppText variant="body">{i.name}</AppText>
              <AppText variant="caption" color="muted">{`${i.unitPriceLabel} each`}</AppText>
            </View>
            <AppText variant="body" style={styles.tabular}>{i.lineTotalLabel}</AppText>
          </View>
        ))}
        <Divider />
        <MoneyLine label="Subtotal" value={m.subtotalLabel} muted />
        {m.discountLabel ? (
          <MoneyLine label={`Discount${m.discountCode ? ` (${m.discountCode})` : ""}`} value={`−${m.discountLabel}`} muted />
        ) : null}
        <MoneyLine label="Shipping" value={m.shippingLabel} muted />
        {m.adminFeeLabel ? <MoneyLine label={m.adminFeeName || "Service fee"} value={m.adminFeeLabel} muted /> : null}
        {m.paymentFeeLabel ? <MoneyLine label={m.paymentFeeName || "Payment fee"} value={m.paymentFeeLabel} muted /> : null}
        <Divider />
        <MoneyLine label="Total" value={m.totalLabel} strong />
      </Card>
    </View>
  );
}

export function PaymentSection({ order }: { order: OrderDetail }) {
  const t = useTheme();
  const p = order.payment;
  const icon = p.hasProof ? "document-attach-outline" : p.tone === "success" ? "wallet-outline" : "time-outline";
  return (
    <View>
      <SectionLabel>Payment</SectionLabel>
      <Card style={{ gap: SPACE.md }}>
        <View style={styles.payHead}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="muted">Method</AppText>
            <AppText variant="bodyStrong">{p.method}</AppText>
          </View>
          <Pill tone={p.tone} icon={icon} label={p.label} />
        </View>
        {order.paymentProofUrl ? (
          <>
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="Payment proof. Opens full screen"
              onPress={() => router.push({ pathname: "/order/[id]/proof", params: { id: order.id } })}
              style={[styles.proof, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt }]}
            >
              <Image source={{ uri: order.paymentProofUrl }} contentFit="cover" style={StyleSheet.absoluteFill} />
              <View style={[styles.proofTag, { backgroundColor: t.colors.overlay }]}>
                <Ionicons name="expand-outline" size={14} color="#fff" />
                <AppText variant="caption" color="#fff">View proof</AppText>
              </View>
            </Pressable>
            <AppText variant="caption" color="muted">
              The customer attached this. Check it against your account before confirming — an upload alone isn't proof the money arrived.
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color="muted">No payment proof was attached to this order.</AppText>
        )}
      </Card>
    </View>
  );
}

export function NotesSection({ order, onEdit }: { order: OrderDetail; onEdit?: () => void }) {
  const t = useTheme();
  const hasShipping = !!(order.courier || order.trackingNumber || order.shippingNote);
  const shippingLabel = [order.courier, order.trackingNumber].filter(Boolean).join(" · ");
  return (
    <View>
      <SectionLabel>Delivery & notes</SectionLabel>
      <Card padded={false}>
        {order.customerNote ? (
          <View style={[styles.quote, { borderLeftColor: t.brand.accent }]}>
            <AppText variant="caption" color="muted">Note from the customer</AppText>
            <AppText variant="body" selectable>{order.customerNote}</AppText>
          </View>
        ) : null}
        <Row
          icon="paper-plane-outline"
          label={hasShipping ? shippingLabel || "Delivery note added" : "Add courier & tracking"}
          detail={order.shippingNote ? `Your note: ${order.shippingNote}` : hasShipping ? undefined : "Plus an optional note for the customer"}
          onPress={onEdit}
        />
      </Card>
    </View>
  );
}

export function TimelineSection({ order }: { order: OrderDetail }) {
  const t = useTheme();
  if (order.timeline.length === 0) return null;
  const events = [...order.timeline].reverse();
  return (
    <View>
      <SectionLabel>History</SectionLabel>
      <Card>
        {events.map((e, i) => {
          const meta = STATUS_META[e.status];
          const c = t.tone(meta.tone);
          return (
            <View key={`${e.status}-${e.at}-${i}`} style={styles.event}>
              <View style={styles.eventRail}>
                <View style={[styles.eventDot, { backgroundColor: c.bg }]}>
                  <Ionicons name={meta.icon} size={14} color={c.fg} />
                </View>
                {i < events.length - 1 ? <View style={[styles.eventLine, { backgroundColor: t.colors.border }]} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: SPACE.md }}>
                <AppText variant="bodyStrong">{meta.label}</AppText>
                <AppText variant="caption" color="muted">{formatFull(e.at)}</AppText>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
  moneyLine: { flexDirection: "row", alignItems: "baseline", gap: SPACE.md },
  item: { flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" },
  qty: { minWidth: 30, fontVariant: ["tabular-nums"] },
  payHead: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  proof: { height: 180, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  proofTag: {
    position: "absolute",
    right: SPACE.sm,
    bottom: SPACE.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  quote: { margin: SPACE.lg, marginBottom: 0, paddingLeft: SPACE.md, borderLeftWidth: 3, gap: 2 },
  event: { flexDirection: "row", gap: SPACE.md },
  eventRail: { alignItems: "center", width: 28 },
  eventDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  eventLine: { width: 2, flex: 1, marginVertical: 2 },
});
