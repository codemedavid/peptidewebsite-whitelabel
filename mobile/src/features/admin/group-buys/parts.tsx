import { useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Card, Pill } from "@/ui/primitives";
import { PAYMENT_TONE, fmtDate, type ProductToOrder, type RoundOrderRow } from "./model";

/**
 * Display pieces shared by the round list, the report sheet and the round
 * dashboard: the website's stat tiles, label/value panels, "Products to order"
 * table, order-line cards (its wide table, stacked for a phone) and the
 * payment-proof lightbox.
 */

export type Tile = { label: string; value: string | number; hint?: string };

/** The website's summary-card grid, two per row. */
export function TileGrid({ tiles }: { tiles: Tile[] }) {
  const t = useTheme();
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessible
          accessibilityLabel={`${tile.label}: ${tile.value}${tile.hint ? `, ${tile.hint}` : ""}`}
          style={[styles.tile, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
        >
          <AppText variant="overline" color="muted" numberOfLines={1}>
            {tile.label.toUpperCase()}
          </AppText>
          <AppText variant="heading" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1}>
            {String(tile.value)}
          </AppText>
          {tile.hint ? (
            <AppText variant="caption" color="faint" numberOfLines={1}>
              {tile.hint}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A titled card of label → value rows (Overview / Financial / Vials). */
export function Panel({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <Card style={{ gap: SPACE.xs }}>
      <AppText variant="overline" color="link" accessibilityRole="header" style={{ marginBottom: SPACE.xs }}>
        {title.toUpperCase()}
      </AppText>
      {children}
      {note ? (
        <AppText variant="caption" color="faint" style={{ marginTop: SPACE.xs }}>
          {note}
        </AppText>
      ) : null}
    </Card>
  );
}

export function KV({ label, value }: { label: string; value: string | number }) {
  const t = useTheme();
  return (
    <View style={[styles.kv, { borderColor: t.colors.border }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="body" color="muted" style={{ flexShrink: 1 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ textAlign: "right", flexShrink: 1 }}>
        {String(value)}
      </AppText>
    </View>
  );
}

/** "Products to order" — vials per product, cancelled excluded, with the TOTAL row. */
export function ProductsToOrder({ lines, totalVials }: { lines: ProductToOrder[]; totalVials: number }) {
  const t = useTheme();
  return (
    <Card style={{ gap: 0 }}>
      <View style={styles.pHead}>
        <AppText variant="caption" color="muted" style={{ flex: 1 }}>
          Product
        </AppText>
        <AppText variant="caption" color="muted" style={styles.pNum}>
          Vials
        </AppText>
        <AppText variant="caption" color="muted" style={styles.pNum}>
          Orders
        </AppText>
      </View>
      {lines.map((l) => (
        <View
          key={`${l.productId ?? l.product}-${l.variation ?? ""}`}
          style={[styles.pRow, { borderColor: t.colors.border }]}
          accessible
          accessibilityLabel={`${l.product}: ${l.vials} vials to order, ${l.orders} orders`}
        >
          <AppText variant="body" style={{ flex: 1 }}>
            {l.product}
          </AppText>
          <AppText variant="bodyStrong" style={styles.pNum}>
            {l.vials}
          </AppText>
          <AppText variant="body" color="muted" style={styles.pNum}>
            {l.orders}
          </AppText>
        </View>
      ))}
      <View style={[styles.pRow, { borderColor: t.colors.text, borderTopWidth: 2 }]}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          TOTAL
        </AppText>
        <AppText variant="bodyStrong" style={styles.pNum}>
          {totalVials}
        </AppText>
        <View style={styles.pNum} />
      </View>
    </Card>
  );
}

/** One order LINE. Cancelled lines stay listed (audit trail) but struck through. */
export function OrderLineCard({
  line,
  showBatch,
  money,
  onProof,
}: {
  line: RoundOrderRow;
  showBatch?: boolean;
  money: (n: number) => string;
  onProof: (url: string, label: string) => void;
}) {
  const t = useTheme();
  const strike = line.counted ? null : ({ textDecorationLine: "line-through" } as const);
  return (
    <Card style={{ gap: SPACE.xs, opacity: line.counted ? 1 : 0.55 }}>
      <View style={styles.lineTop}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" style={strike}>
            {`#${line.orderNumber} · ${line.product}`}
          </AppText>
          <AppText variant="caption" color="muted" style={strike}>
            {`${fmtDate(line.orderDate)} · ${line.vials} vial${line.vials === 1 ? "" : "s"} · ${money(line.price)}`}
          </AppText>
        </View>
        {line.proofUrl ? (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={`View payment proof for order ${line.orderNumber}`}
            onPress={() => onProof(line.proofUrl as string, line.orderNumber)}
            style={[styles.thumb, { borderColor: t.colors.border }]}
          >
            <Image source={{ uri: line.proofUrl }} style={styles.thumbImg} contentFit="cover" />
          </Pressable>
        ) : null}
      </View>
      <AppText variant="body">{line.customer || "—"}</AppText>
      {line.contact ? (
        <AppText variant="caption" color="muted" selectable>
          {line.contact}
        </AppText>
      ) : null}
      {line.address ? (
        <AppText variant="caption" color="muted" selectable>
          {line.address}
        </AppText>
      ) : null}
      {showBatch && line.batch ? (
        <AppText variant="caption" color="faint">
          {`Batch ${line.batch}`}
        </AppText>
      ) : null}
      <View style={styles.badges}>
        <Pill tone={PAYMENT_TONE[line.paymentStatus] ?? "neutral"} size="sm" label={line.paymentStatus} />
        <Pill tone="neutral" size="sm" label={line.orderStatus || "—"} />
        {line.paymentMethod ? <Pill tone="info" size="sm" label={line.paymentMethod} /> : null}
      </View>
    </Card>
  );
}

/** Full-size payment proof over everything, tap × to close. */
export function ProofViewer({ proof, onClose }: { proof: { url: string; label: string } | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!proof} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.proofBg}>
        {proof ? (
          <Image
            source={{ uri: proof.url }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel={`Payment proof for order ${proof.label}`}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close payment proof"
          hitSlop={12}
          onPress={onClose}
          style={[styles.proofClose, { top: insets.top + SPACE.md }]}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </Pressable>
        {proof ? (
          <AppText variant="label" color="#FFFFFF" style={[styles.proofLabel, { bottom: insets.bottom + SPACE.lg }]}>
            {`Order #${proof.label}`}
          </AppText>
        ) : null}
      </View>
    </Modal>
  );
}

export function useProofViewer() {
  const [proof, setProof] = useState<{ url: string; label: string } | null>(null);
  return {
    open: (url: string, label: string) => setProof({ url, label }),
    viewer: <ProofViewer proof={proof} onClose={() => setProof(null)} />,
  };
}

/** A read-only page sheet (the website's report modal): title, Close, scrolling body, footer. */
export function ViewSheet({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <View
          style={[
            styles.sheetBar,
            {
              borderColor: t.colors.border,
              backgroundColor: t.colors.surface,
              paddingTop: Platform.OS === "android" ? insets.top + SPACE.sm : SPACE.md,
            },
          ]}
        >
          <AppText variant="heading" numberOfLines={1} accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <AppText variant="bodyStrong" color="link">
              Close
            </AppText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        {footer ? (
          <View
            style={[
              styles.sheetFooter,
              { borderColor: t.colors.border, backgroundColor: t.colors.surface, paddingBottom: Math.max(insets.bottom, SPACE.md) },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** A two-or-more choice button group (the website's Visible/Hidden, Enabled/Disabled). */
export function ButtonGroup<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { key: K; label: string; blocked?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={styles.groupRow}>
      <AppText variant="label" color="muted" style={{ flex: 1 }}>
        {label}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
        {options.map((o) => {
          const active = o.key === value;
          const off = !!disabled || !!o.blocked;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: off }}
              accessibilityLabel={`${label}: ${o.label}`}
              disabled={off || active}
              onPress={() => onChange(o.key)}
              style={[
                styles.groupBtn,
                {
                  borderColor: active ? t.colors.text : t.colors.border,
                  backgroundColor: active ? t.colors.text : t.colors.surface,
                  opacity: off && !active ? 0.4 : 1,
                },
              ]}
            >
              <AppText variant="label" color={active ? t.colors.bg : "text"}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  tile: { flexBasis: "47%", flexGrow: 1, padding: SPACE.md, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth },
  pHead: { flexDirection: "row", paddingBottom: 6 },
  pRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  pNum: { width: 60, textAlign: "right", fontVariant: ["tabular-nums"] },
  lineTop: { flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" },
  thumb: { width: 48, height: 48, borderRadius: RADIUS.sm, borderWidth: 1, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  proofBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  proofClose: { position: "absolute", right: SPACE.lg, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  proofLabel: { position: "absolute", alignSelf: "center" },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  sheetFooter: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.sm, borderTopWidth: StyleSheet.hairlineWidth },
  groupRow: { flexDirection: "row", alignItems: "center", gap: SPACE.md, flexWrap: "wrap" },
  group: { flexDirection: "row", gap: 6 },
  groupBtn: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: RADIUS.pill, borderWidth: 1 },
});
