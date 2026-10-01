import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { catalogKeys, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import { formatMoney } from "@/features/admin/catalog/currency";
import { brandSymbol, type CatalogProduct } from "@/features/admin/catalog/model";
import type { AdminBrand } from "@/features/admin/bridge";
import { success } from "@/features/admin/setup/data";
import { ChoicePills, Hint } from "@/features/admin/setup/ui";
import { SPACE } from "@/theme/tokens";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card, Pill } from "@/ui/primitives";
import { gbKeys } from "./hooks";
import type { GroupBuy, GroupBuyCapabilities, ListResult } from "./model";

/**
 * Group Buys → Pricing (AdminGroupBuyPricing → saveGroupBuyProductPricingAction):
 * the whole catalog with each product's regular and group-buy price; set a GB
 * price, pause/resume, or retire it from the group buy. The server re-checks
 * the module, `groupbuy.can_edit` AND a catalog grant on every write.
 */

type Filter = "all" | "gb";

/** two-ways.ts groupBuyLine — the storefront's own resolution of the two prices. */
function priceLine(p: CatalogProduct) {
  const regularPrice = Math.max(0, p.price || 0);
  const candidate = typeof p.gbPrice === "number" && p.gbPrice > 0 ? p.gbPrice : regularPrice;
  const gbPrice = candidate > 0 && candidate < regularPrice ? candidate : regularPrice;
  const savings = Math.max(0, regularPrice - gbPrice);
  return { regularPrice, gbPrice, savings, hasSavings: savings > 0 };
}

/** gb-pricing.ts gbPriceError — same words, so the owner sees them before a round trip. */
function gbPriceError(p: CatalogProduct, next: number): string | null {
  if (!Number.isFinite(next)) return "Enter a group-buy price.";
  if (next <= 0) return "The group-buy price has to be more than 0.";
  const regular = Math.max(0, p.price || 0);
  if (next >= regular) {
    return `The group-buy price (${next.toLocaleString()}) has to be below the regular price (${regular.toLocaleString()}) — otherwise the storefront shows no saving.`;
  }
  return null;
}

/** Non-archived rounds carrying the product; an empty assignment covers everything. */
const roundsCarrying = (id: string, rounds: GroupBuy[]) =>
  rounds.filter((gb) => gb.status !== "archived" && (gb.productIds.length === 0 || gb.productIds.includes(id))).map((gb) => gb.name);

type PricingResult = { ok: true; product: CatalogProduct; groupBuys: GroupBuy[]; warning?: string };

export function PricingTab({
  brand,
  caps,
  groupBuys,
  products,
}: {
  brand: AdminBrand;
  caps: GroupBuyCapabilities;
  groupBuys: GroupBuy[];
  products: CatalogProduct[];
}) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const refreshCatalog = useCatalogRefresh();
  const currency = brandSymbol(brand);
  const fmt = (n: number) => formatMoney(Math.max(0, n || 0), currency, { decimals: false });

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      products.map((p) => ({
        product: p,
        isGroupBuy: p.productType === "gb",
        available: p.purchasable !== false,
        roundNames: roundsCarrying(p.id, groupBuys),
        ...priceLine(p),
      })),
    [products, groupBuys],
  );
  const gbCount = rows.filter((r) => r.isGroupBuy).length;
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (filter === "gb" ? r.isGroupBuy : true)).filter((r) => !q || r.product.name.toLowerCase().includes(q));

  const run = async (productId: string, payload: Record<string, unknown>): Promise<boolean> => {
    setBusyId(productId);
    setRowError(null);
    try {
      const res = unwrap(await adminBridge.call<PricingResult | { error: string }>("saveGroupBuyProductPricingAction", { productId, ...payload }));
      // Swap in the saved product and the (possibly rewritten) rounds, then resync.
      qc.setQueryData<CatalogProduct[]>(catalogKeys.products(scope, currency), (cur) => cur?.map((p) => (p.id === res.product.id ? res.product : p)));
      qc.setQueryData<ListResult>(gbKeys.list(scope), (cur) => (cur ? { ...cur, groupBuys: res.groupBuys } : cur));
      refreshCatalog();
      success();
      // A warning is not a failure — the write went through — but it changes what the round sells.
      if (res.warning) {
        setRowError(res.warning);
        Alert.alert("Saved — please check", res.warning);
      }
      return true;
    } catch (e) {
      setRowError(e instanceof Error ? e.message : "Couldn't save — please try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const savePrice = async (p: CatalogProduct) => {
    const price = Number(draft);
    const invalid = gbPriceError(p, draft.trim() === "" ? Number.NaN : price);
    if (invalid) return setRowError(invalid);
    if (await run(p.id, { op: "price", price })) setEditingId(null);
  };

  const remove = (p: CatalogProduct) => {
    const live = groupBuys.filter((gb) => gb.status === "active" && (gb.productIds.length === 0 || gb.productIds.includes(p.id)));
    const headsUp = live.length ? `"${p.name}" is in the LIVE round "${live[0].name}". Removing it changes what customers see right now.\n\n` : "";
    Alert.alert(
      `Remove "${p.name}" from the group buy?`,
      `${headsUp}It stays in your catalog at its regular price — only the group-buy price and the round assignment are cleared.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void run(p.id, { op: "remove" }) },
      ],
    );
  };

  return (
    <View style={{ gap: SPACE.md }}>
      <ChoicePills
        label="Show"
        options={[
          { key: "all", label: `All products (${rows.length})` },
          { key: "gb", label: `In the group buy (${gbCount})` },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Search products…" autoCorrect={false} returnKeyType="search" />
      {!caps.canEdit ? <Hint>Your plan includes group buys but not editing — prices are read-only here.</Hint> : null}
      {rowError && editingId === null ? <Hint tone="danger">{rowError}</Hint> : null}

      {visible.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title={
            q
              ? `No products match “${query.trim()}”.`
              : filter === "gb"
                ? "No products have a group-buy price yet. Switch to All products and tap one to set its price."
                : "No products yet — add some on the Products screen first."
          }
        />
      ) : null}

      {visible.map((row) => {
        const p = row.product;
        const editing = editingId === p.id;
        const busy = busyId === p.id;
        return (
          <Card key={p.id} style={{ gap: SPACE.sm, opacity: row.available ? 1 : 0.7 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, set group-buy price`}
              disabled={!caps.canEdit || busy}
              onPress={() => {
                setRowError(null);
                setEditingId(p.id);
                setDraft(row.hasSavings && row.gbPrice > 0 ? String(row.gbPrice) : "");
              }}
              style={{ gap: 2 }}
            >
              <AppText variant="bodyStrong" color={caps.canEdit ? "link" : "text"}>
                {p.name}
              </AppText>
              <AppText variant="caption" color="muted">
                {`Regular ${fmt(row.regularPrice)}${
                  row.hasSavings ? ` · Group buy ${fmt(row.gbPrice)} · saves ${fmt(row.savings)}` : " · no group-buy price set"
                }${row.roundNames.length ? ` · in ${row.roundNames.join(", ")}` : ""}`}
              </AppText>
            </Pressable>
            {!row.available ? (
              <View style={styles.badges}>
                <Pill tone="neutral" size="sm" icon="pause-circle-outline" label="Not available" />
              </View>
            ) : null}

            {editing ? (
              <View style={{ gap: SPACE.sm }}>
                <Field
                  label={`Group-buy price (${currency})`}
                  value={draft}
                  onChangeText={setDraft}
                  keyboardType="decimal-pad"
                  autoFocus
                  placeholder={`Below ${fmt(row.regularPrice)}`}
                  error={rowError}
                  onSubmitEditing={() => void savePrice(p)}
                />
                <View style={styles.actions}>
                  <Button label="Save" loading={busy} disabled={busy} onPress={() => void savePrice(p)} />
                  <Button
                    label="Cancel"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      setEditingId(null);
                      setRowError(null);
                    }}
                  />
                </View>
              </View>
            ) : null}

            {caps.canEdit ? (
              <View style={styles.actions}>
                <Button
                  label={row.available ? "Set not available" : "Make available"}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void run(p.id, { op: "availability", available: !row.available })}
                />
                {row.isGroupBuy ? <Button label="Remove" variant="danger" disabled={busy} onPress={() => remove(p)} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  badges: { flexDirection: "row", gap: 6 },
});
