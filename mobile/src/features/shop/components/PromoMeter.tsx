import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopFreeShippingProgress, ShopVoucherRung } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { money } from "../lib/money";
import {
  freeShippingLine,
  rungCaption,
  rungMinimum,
  voucherHeadline,
  voucherProgress,
} from "../lib/promo-meter";

type Props = {
  currency: string;
  vouchers?: ShopVoucherRung[];
  freeShipping?: ShopFreeShippingProgress | null;
};

/**
 * "How close am I" — the website cart's free-shipping bar and voucher ladder.
 * Presentational: every number is the server quote's. Renders nothing when the
 * store runs neither (or the server predates them).
 */
export function PromoMeter({ currency, vouchers = [], freeShipping = null }: Props) {
  const t = useTheme();
  if (!freeShipping && vouchers.length === 0) return null;
  const fmt = (n: number) => money(n, currency);
  return (
    <View accessibilityLabel="Savings" style={[styles.box, { backgroundColor: t.colors.surfaceAlt }]}>
      {freeShipping ? (
        <View style={styles.row}>
          <Line icon={freeShipping.reached ? "checkmark-circle" : "car-outline"} strong={freeShipping.reached}>
            {freeShippingLine(freeShipping, fmt)}
          </Line>
          <ProgressBar fraction={freeShipping.fraction} label={`Free shipping at ${fmt(freeShipping.threshold)}`} />
        </View>
      ) : null}
      {vouchers.length > 0 ? <Ladder rungs={vouchers} fmt={fmt} /> : null}
    </View>
  );
}

function Ladder({ rungs, fmt }: { rungs: ShopVoucherRung[]; fmt: (n: number) => string }) {
  const t = useTheme();
  const progress = voucherProgress(rungs);
  return (
    <View style={styles.row}>
      <Line icon="pricetags-outline">{voucherHeadline(rungs, fmt)}</Line>
      {progress !== null ? <ProgressBar fraction={progress} label="Progress to the next voucher" /> : null}
      <View accessibilityRole="list" style={styles.rungs}>
        {rungs.map((r) => {
          const reached = r.state !== "locked";
          const tone = r.state === "applied" ? t.tone("success") : null;
          return (
            <View
              key={r.code}
              accessible
              accessibilityLabel={`${r.offLabel}, ${rungMinimum(r, fmt)}, ${rungCaption(r, fmt)}`}
              style={[
                styles.rung,
                { borderColor: reached ? t.brand.link : t.colors.border, backgroundColor: tone?.bg ?? t.colors.surface },
              ]}
            >
              <AppText variant="bodyStrong" color={tone?.fg}>{r.offLabel}</AppText>
              <AppText variant="caption" color="muted">{rungMinimum(r, fmt)}</AppText>
              <AppText variant="caption" color={reached ? (tone?.fg ?? t.brand.link) : "faint"}>{rungCaption(r, fmt)}</AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Line({ icon, strong, children }: { icon: keyof typeof Ionicons.glyphMap; strong?: boolean; children: string }) {
  const t = useTheme();
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={18} color={t.brand.link} />
      <AppText variant={strong ? "bodyStrong" : "label"} style={{ flex: 1 }}>{children}</AppText>
    </View>
  );
}

function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const t = useTheme();
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { backgroundColor: t.colors.border }]}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: t.brand.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: SPACE.md, borderRadius: RADIUS.lg, gap: SPACE.lg },
  row: { gap: SPACE.sm },
  line: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  track: { height: 6, borderRadius: RADIUS.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: RADIUS.pill },
  rungs: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  rung: { minWidth: 104, flexGrow: 1, flexBasis: 104, padding: SPACE.sm, borderRadius: RADIUS.md, borderWidth: 1, gap: 2 },
});
