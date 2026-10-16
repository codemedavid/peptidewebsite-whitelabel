import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { money } from "../lib/money";
import { FormSection, Notice } from "./ShopUI";

/**
 * Stands in for the payment step on a pay-after-close group-buy order
 * (ShopGroupBuy.invoice): nothing is paid now — the invoice arrives in chat
 * when the round closes. Says which of the two cases this is, so the shopper
 * knows why shipping is (or isn't) on this order.
 */
export function PayLaterSection({
  roundName,
  shippingFee,
  addOn,
  currency,
}: {
  roundName: string;
  shippingFee: number;
  /** The shopper already ordered in this round: this joins that invoice. */
  addOn: boolean;
  currency: string;
}) {
  const t = useTheme();
  const round = roundName.trim() || "the group buy";
  return (
    <FormSection title="Payment">
      <View style={[styles.card, { backgroundColor: t.colors.surfaceAlt }]}>
        <View style={[styles.icon, { backgroundColor: t.brand.primary }]}>
          <Ionicons name="receipt-outline" size={20} color={t.brand.onPrimary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">Pay when the group buy closes</AppText>
          <AppText variant="caption" color="muted">
            {`No payment today. When ${round} closes, your invoice arrives in Chats with your total and the ways to pay.`}
          </AppText>
        </View>
      </View>
      {addOn ? (
        <Notice tone="success" icon="add-circle-outline">
          {`Added to your ${round} invoice — no extra shipping fee.`}
        </Notice>
      ) : shippingFee > 0 ? (
        <Notice tone="info" icon="cube-outline">
          {`Shipping is ${money(shippingFee, currency)} once for the whole group buy. Order again before it closes and it joins the same invoice — no extra shipping.`}
        </Notice>
      ) : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, alignItems: "center" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
