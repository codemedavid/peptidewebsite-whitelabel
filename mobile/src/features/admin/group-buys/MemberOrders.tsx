import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Card, Pill } from "@/ui/primitives";
import { TileGrid } from "./parts";
import { fmtDate, memberOrderTotals, memberProductLabel, type MemberOrder } from "./model";

/**
 * "Orders per customer" on a round's dashboard (website GbMemberOrders.tsx):
 * every checkout a customer made in the round merged into one row — what they
 * bought, what it's worth, what they've paid and what they still owe. The
 * merging is the server's (gb-member-orders.ts); this only filters and renders.
 */

function matches(m: MemberOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.name, m.email, m.contact, ...m.checkouts.map((c) => c.orderNumber)].some((v) => v.toLowerCase().includes(q));
}

type Props = { members: MemberOrder[]; money: (n: number) => string };

export function MemberOrders({ members, money }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const totals = useMemo(() => memberOrderTotals(members), [members]);
  const shown = members.filter((m) => matches(m, query));
  const owing = members.filter((m) => m.balance > 0).length;

  return (
    <View style={{ gap: SPACE.md }}>
      <View style={{ gap: 2 }}>
        <AppText variant="overline" color="link" accessibilityRole="header">
          {`ORDERS PER CUSTOMER (${members.length})`}
        </AppText>
        <AppText variant="caption" color="muted">
          Every checkout a customer made in this group buy, combined. Matched by email or phone number.
        </AppText>
      </View>
      <TileGrid
        tiles={[
          { label: "Total value", value: money(totals.total) },
          { label: "Paid", value: money(totals.paid) },
          { label: "Balance", value: money(totals.balance), hint: totals.balance > 0 ? "still owed" : "fully paid" },
        ]}
      />
      {members.length === 0 ? (
        <EmptyState icon="people-outline" title="No customers have ordered in this group buy yet." />
      ) : (
        <>
          <Field
            label="Search customers"
            value={query}
            onChangeText={setQuery}
            placeholder="Name, phone, email or order #…"
            autoCorrect={false}
            autoCapitalize="none"
            hint={owing === 0 ? "Everyone is fully paid" : `${owing} with a balance`}
          />
          {shown.length === 0 ? (
            <EmptyState icon="search-outline" title={`No customer matches “${query.trim()}”.`} />
          ) : (
            <Card padded={false} style={{ overflow: "hidden" }}>
              {shown.map((m, i) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  money={money}
                  first={i === 0}
                  expanded={open === m.id}
                  onToggle={() => setOpen((cur) => (cur === m.id ? null : m.id))}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </View>
  );
}

type RowProps = { member: MemberOrder; money: (n: number) => string; first: boolean; expanded: boolean; onToggle: () => void };

function MemberRow({ member: m, money, first, expanded, onToggle }: RowProps) {
  const t = useTheme();
  const vials = m.products.reduce((s, p) => s + p.qty, 0);
  const due = m.balance > 0;
  const meta = `${m.contact} · ${m.checkouts.length} checkout${m.checkouts.length === 1 ? "" : "s"} · ${vials} vial${vials === 1 ? "" : "s"}`;
  const border = first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border };

  return (
    <View style={border}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${m.name}, ${money(m.total)}, ${due ? `${money(m.balance)} due` : "fully paid"}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.summary, { backgroundColor: expanded || pressed ? t.colors.surfaceAlt : "transparent" }]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {m.name}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {meta}
          </AppText>
        </View>
        <View style={styles.money}>
          <AppText variant="bodyStrong" style={styles.num}>
            {money(m.total)}
          </AppText>
          <Pill size="sm" tone={due ? "warning" : "success"} label={due ? `${money(m.balance)} due` : "Fully paid"} />
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={t.colors.textMuted} />
      </Pressable>
      {expanded ? <MemberDetail member={m} money={money} /> : null}
    </View>
  );
}

function MemberDetail({ member: m, money }: { member: MemberOrder; money: (n: number) => string }) {
  const t = useTheme();
  const line = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border };
  return (
    <View style={styles.body}>
      <AppText variant="overline" color="muted">
        PRODUCTS (ALL CHECKOUTS COMBINED)
      </AppText>
      {m.products.map((p) => (
        <View key={`${p.product}::${p.variation ?? ""}`} style={[styles.line, line]}>
          <AppText variant="body" style={{ flex: 1 }}>
            {memberProductLabel(p)}
          </AppText>
          <AppText variant="body" color="muted" style={styles.qty}>
            {`×${p.qty}`}
          </AppText>
          <AppText variant="body" style={styles.num}>
            {money(p.amount)}
          </AppText>
        </View>
      ))}

      <AppText variant="overline" color="muted" style={{ marginTop: SPACE.sm }}>
        CHECKOUTS & PAYMENTS
      </AppText>
      {m.checkouts.map((c) => (
        <View key={c.orderNumber} style={[styles.line, line]}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{c.orderNumber}</AppText>
            <AppText variant="caption" color="muted">
              {`${fmtDate(c.date)}${c.adminFee > 0 ? ` · admin fee ${money(c.adminFee)}` : ""}`}
            </AppText>
          </View>
          <View style={styles.money}>
            <AppText variant="body" style={styles.num}>
              {money(c.total)}
            </AppText>
            <Pill size="sm" tone={c.paid ? "success" : "warning"} label={c.paid ? "Paid" : "Not yet paid"} />
          </View>
        </View>
      ))}
      <View style={[styles.line, { borderTopWidth: 2, borderTopColor: t.colors.text }]}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {`Total · paid ${money(m.paid)}${m.adminFee > 0 ? ` · fees ${money(m.adminFee)}` : ""}`}
        </AppText>
        <AppText variant="bodyStrong" style={styles.num}>
          {money(m.total)}
        </AppText>
      </View>
      <AppText variant="bodyStrong" color={m.balance > 0 ? t.tone("warning").fg : t.tone("success").fg}>
        {m.balance > 0 ? `${money(m.balance)} due` : "Fully paid"}
      </AppText>

      <AppText variant="caption" color="muted" selectable>
        {`Ship to ${m.address}${m.email && m.email !== m.contact ? ` · ${m.email}` : ""}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, minHeight: 56 },
  money: { alignItems: "flex-end", gap: 3 },
  num: { fontVariant: ["tabular-nums"], textAlign: "right" },
  qty: { width: 44, textAlign: "right", fontVariant: ["tabular-nums"] },
  body: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg, paddingTop: SPACE.xs, gap: SPACE.xs, borderRadius: RADIUS.md },
  line: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingVertical: 6 },
});
