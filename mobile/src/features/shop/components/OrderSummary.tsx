import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { ShopFee, ShopOrderItem } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText, Divider } from "@/ui/primitives";
import { minus, money } from "../lib/money";

/** Totals exactly as the server computed them (a quote, or a placed order). */
export type Totals = {
  items: ShopOrderItem[];
  subtotal: number;
  shippingFee: number;
  courier?: string;
  adminFee: ShopFee | null;
  paymentFee: ShopFee | null;
  discount: { code: string; label: string; amount: number } | null;
  total: number;
};

export function OrderSummary({
  totals,
  currency,
  showItems = true,
  updating,
  shippingPending,
  invoice,
}: {
  totals: Totals;
  currency: string;
  showItems?: boolean;
  /** A newer quote is loading — the numbers are dimmed until it lands. */
  updating?: boolean;
  /** No courier picked yet: say so instead of "Free". */
  shippingPending?: boolean;
  /** A pay-after-close group-buy order: shipping is once per round. */
  invoice?: { addOn: boolean } | null;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.sm, opacity: updating ? 0.55 : 1 }} accessibilityState={{ busy: !!updating }}>
      {showItems
        ? totals.items.map((i, n) => (
            <View key={`${n}:${i.name}`} style={styles.row}>
              <AppText variant="body" color="muted" style={{ flex: 1 }} numberOfLines={2}>
                {`${i.qty} × ${i.name}`}
              </AppText>
              <AppText variant="body">{money(i.price * i.qty, currency)}</AppText>
            </View>
          ))
        : null}
      {showItems ? <Divider /> : null}
      <Line label="Subtotal" value={money(totals.subtotal, currency)} />
      <Line
        label={invoice ? "Shipping · once per group buy" : totals.courier ? `Shipping · ${totals.courier}` : "Shipping"}
        value={
          shippingPending
            ? "Choose a courier"
            : invoice?.addOn
              ? "Already on your invoice"
              : totals.shippingFee > 0
                ? money(totals.shippingFee, currency)
                : "Free"
        }
        muted={shippingPending}
        color={invoice?.addOn && !shippingPending ? t.tone("success").fg : undefined}
      />
      {totals.adminFee ? <Line label={totals.adminFee.label} value={money(totals.adminFee.amount, currency)} /> : null}
      {totals.paymentFee ? <Line label={totals.paymentFee.label} value={money(totals.paymentFee.amount, currency)} /> : null}
      {totals.discount ? (
        <Line
          label={totals.discount.label || `Promo ${totals.discount.code}`}
          value={minus(totals.discount.amount, currency)}
          color={t.tone("success").fg}
        />
      ) : null}
      <Divider />
      <View style={styles.row} accessible accessibilityLabel={`${invoice ? "Due at close" : "Total"} ${money(totals.total, currency)}`}>
        <AppText variant="heading" style={{ flex: 1 }}>
          {invoice ? "Due at close" : "Total"}
        </AppText>
        {updating ? <ActivityIndicator size="small" color={t.brand.link} style={{ marginRight: SPACE.sm }} /> : null}
        <AppText variant="stat">{money(totals.total, currency)}</AppText>
      </View>
    </View>
  );
}

function Line({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" color="muted" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </AppText>
      <AppText variant="body" color={color ?? (muted ? "faint" : "text")}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
