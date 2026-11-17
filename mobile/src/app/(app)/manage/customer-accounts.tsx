import { useMemo, useRef, useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { adminBridge } from "@/features/admin/bridge";
import { setupKeys, success, useAdminBrand } from "@/features/admin/setup/data";
import { formatMoney } from "@/features/admin/catalog/currency";
import { brandSymbol } from "@/features/admin/catalog/model";
import { AccountsInsights, SEGMENT_TONE, shortDate } from "@/features/customer-accounts/AccountsInsights";
import { MembersOnlyCard } from "@/features/customer-accounts/MembersOnlyCard";
import {
  CUSTOMER_FILTERS,
  FILTER_ORDER,
  PERIODS,
  SEGMENT_LABELS,
  VIP_SPEND,
  buildAccountStats,
  countByFilter,
  customersCsv,
  filterCustomers,
  type AccountStats,
  type CustomerFilter,
  type CustomerPeriod,
  type LedgerEntry,
} from "@/features/customer-accounts/analytics";
import { shareCsv } from "@/features/insights/shareCsv";
import { Chips, SectionHeader } from "@/ui/kit";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card, Pill } from "@/ui/primitives";

/** StoreCustomerRow from src/actions/customer-accounts.ts. */
type StoreCustomer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: "active" | "disabled";
  joinedAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  /** null without the Orders grant. */
  spent: number | null;
  lastOrderAt: string | null;
  /** Group-buy email entry — no password to reset. */
  emailOnly: boolean;
  unlinkedOrders: number;
};

type CustomerList = { customers: StoreCustomer[]; ledger: LedgerEntry[] | null };

const THOUSAND = 1000;
/** Lifetime figures with no orders read as a dash, like the website table. */
const dash = "—";

type CustomerDraft = Pick<StoreCustomer, "name" | "email" | "phone">;

/** Inline editor that opens inside a customer's card. */
function CustomerEditor({
  customer,
  saving,
  onSave,
  onCancel,
}: {
  customer: StoreCustomer;
  saving: boolean;
  onSave: (draft: CustomerDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CustomerDraft>({ name: customer.name, email: customer.email, phone: customer.phone });
  const set = (key: keyof CustomerDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <View style={{ gap: SPACE.md }}>
      <Field label="Name" value={draft.name} onChangeText={set("name")} autoCapitalize="words" />
      <Field
        label="Email"
        value={draft.email}
        onChangeText={set("email")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        hint="Changing it changes what they sign in with. Their password stays the same."
      />
      <Field label="Phone" value={draft.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
      <View style={styles.editActions}>
        <Button label="Cancel" variant="ghost" disabled={saving} onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Save" loading={saving} onPress={() => onSave(draft)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** One label/value fact on a customer's card ("Avg order ₱1,200"). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="caption" color="faint">{label}</AppText>
      <AppText variant="label" style={styles.tabular}>{value}</AppText>
    </View>
  );
}

type CardProps = {
  c: StoreCustomer;
  s: AccountStats | undefined;
  hasLedger: boolean;
  canOrders: boolean;
  online: boolean;
  busyId: string | null;
  editing: boolean;
  money: (n: number) => string;
  onEdit: () => void;
  onSave: (draft: CustomerDraft) => void;
  onCancelEdit: () => void;
  onReset: () => void;
  onToggle: () => void;
  onDelete: () => void;
};

/** One customer: the website table row's columns, then its row tools. */
function CustomerCard(p: CardProps) {
  const { c, s, hasLedger, money, busyId, online } = p;
  const segment = s?.segment ?? "none";
  const orders = hasLedger ? (s?.orders ?? 0) : c.orderCount;
  const spent = hasLedger ? (s?.spent ?? 0) : c.spent;
  const openHistory = () => router.push({ pathname: "/customer-account/[id]", params: { id: c.id } });
  return (
    <Card style={{ gap: SPACE.sm }}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>{c.name}</AppText>
        {spent !== null ? <AppText variant="bodyStrong" style={styles.tabular}>{money(spent)}</AppText> : null}
      </View>
      <View style={styles.pills}>
        {hasLedger ? <Pill tone={SEGMENT_TONE[segment]} size="sm" label={SEGMENT_LABELS[segment]} /> : null}
        {c.emailOnly ? <Pill tone="info" size="sm" label="Email only" /> : null}
        <Pill tone={c.status === "active" ? "success" : "danger"} size="sm" label={c.status === "active" ? "Active" : "Disabled"} />
      </View>
      <AppText variant="caption" color="muted">{c.phone ? `${c.email} · ${c.phone}` : c.email}</AppText>
      <View style={styles.facts}>
        <Fact label="Orders" value={orders.toLocaleString()} />
        {hasLedger ? <Fact label="Avg order" value={s && s.orders > 0 ? money(s.avg) : dash} /> : null}
        {hasLedger ? <Fact label="Last order" value={shortDate(s?.lastAt ?? null)} /> : null}
        <Fact label="Joined" value={shortDate(c.joinedAt)} />
        <Fact label="Last sign-in" value={c.lastLoginAt ? shortDate(c.lastLoginAt) : "never"} />
      </View>
      {p.canOrders && c.unlinkedOrders > 0 ? (
        <Button
          label={`${c.unlinkedOrders} earlier order${c.unlinkedOrders === 1 ? "" : "s"} to link`}
          variant="ghost"
          icon="link-outline"
          onPress={openHistory}
        />
      ) : null}
      {p.canOrders ? (
        <Button
          label={orders > 0 ? `Order history · ${orders}` : "Order history"}
          icon="receipt-outline"
          accessibilityHint="Opens every order this customer placed"
          onPress={openHistory}
        />
      ) : null}
      {p.editing ? (
        <CustomerEditor customer={c} saving={busyId === c.id} onSave={p.onSave} onCancel={p.onCancelEdit} />
      ) : (
        <Button label="Edit details" variant="secondary" icon="create-outline" disabled={!online || busyId !== null} onPress={p.onEdit} />
      )}
      {c.status === "active" && !c.emailOnly ? (
        <Button label="Reset password" variant="secondary" icon="key-outline" disabled={!online || busyId !== null} onPress={p.onReset} />
      ) : null}
      <Button
        label={c.status === "active" ? "Disable" : "Re-enable"}
        variant={c.status === "active" ? "danger" : "secondary"}
        icon={c.status === "active" ? "ban-outline" : "checkmark-circle-outline"}
        loading={busyId === c.id}
        disabled={!online || (busyId !== null && busyId !== c.id)}
        onPress={p.onToggle}
      />
      <Button label="Delete account" variant="ghost" icon="trash-outline" disabled={!online || busyId !== null} onPress={p.onDelete} />
    </Card>
  );
}

/** Whether this account can open Promo Codes (the server's own admin menu: visibility + grants + locks). */
function usePromoAllowed(): boolean {
  const { scope } = useSignedIn();
  const menu = useQuery({ queryKey: [scope, "admin", "menu"], queryFn: adminBridge.menu });
  return !!menu.data?.groups.some((g) => g.items.some((i) => i.view === "promo" && !i.locked));
}

/**
 * The website's Customers page (AdminCustomers + CustomersInsights +
 * AdminMemberSignIn): the Members-only switch, then — with the Orders grant —
 * the analytics (KPIs per period, revenue from accounts, segments, Top
 * spenders, concentration, needs-attention), then every account with segment
 * filters + counts, search, CSV export of the filtered list, and the row tools:
 * order history, edit (name / email / phone), reset password (a temp one for
 * the owner to send), disable / re-enable (signs them out everywhere) and
 * delete (personal data purged, orders kept). Every number comes from the
 * website's customer-analytics (copied to features/customer-accounts); every
 * write runs the website's own action, gated on the "customers" permission.
 */
export default function CustomerAccountsScreen() {
  const t = useTheme();
  const online = useOnline();
  const { me, scope } = useSignedIn();
  const qc = useQueryClient();
  const listRef = useRef<FlatList<StoreCustomer>>(null);
  const tableY = useRef(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [period, setPeriod] = useState<CustomerPeriod>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const brand = useAdminBrand();
  const promoAllowed = usePromoAllowed();
  const symbol = brand.data ? brandSymbol(brand.data) : "₱";
  const money = (n: number) => formatMoney(Math.round(n), symbol, { decimals: false });
  const moneyShort = (n: number) => (n >= THOUSAND ? `${symbol}${(n / THOUSAND).toFixed(1).replace(/\.0$/, "")}k` : money(n));

  const key = [...setupKeys.all(scope), "customer-accounts"];
  const list = useQuery({
    queryKey: key,
    queryFn: async (): Promise<CustomerList> => {
      const res = await callAction<{ ok: true; customers: StoreCustomer[]; ledger: LedgerEntry[] | null }>("listStoreCustomersAction");
      return { customers: res.customers, ledger: res.ledger ?? null };
    },
  });
  const patchList = (fn: (prev: CustomerList) => CustomerList) =>
    qc.setQueryData<CustomerList>(key, (prev) => (prev ? fn(prev) : prev));

  // "Now" is pinned per load (the fetch time), so the windows don't drift between renders.
  const now = useMemo(() => new Date(list.dataUpdatedAt), [list.dataUpdatedAt]);
  const accounts = useMemo(() => list.data?.customers ?? [], [list.data]);
  const ledger = list.data?.ledger ?? null;
  const hasLedger = ledger !== null;
  const stats = useMemo(() => buildAccountStats(accounts, ledger ?? [], now), [accounts, ledger, now]);
  const counts = useMemo(() => countByFilter(accounts, stats), [accounts, stats]);
  const visible = useMemo(() => filterCustomers(accounts, stats, filter, query), [accounts, stats, filter, query]);
  // Empty tabs are noise: keep All and whatever is selected, hide the rest at 0.
  const filters = FILTER_ORDER.filter(
    (f) => (hasLedger || !CUSTOMER_FILTERS[f].needsLedger) && (f === "all" || f === filter || counts[f] > 0),
  );

  const showFilter = (f: CustomerFilter) => {
    setFilter(f);
    listRef.current?.scrollToOffset({ offset: Math.max(0, tableY.current), animated: true });
  };

  const exportCsv = () => {
    if (visible.length === 0) return void Alert.alert("Nothing to export", "No customers match this filter.");
    const stamp = now.toISOString().slice(0, 10);
    void shareCsv(`customers-${filter}-${stamp}.csv`, customersCsv(visible, hasLedger ? stats : null));
  };

  async function setStatus(c: StoreCustomer, status: StoreCustomer["status"]) {
    setBusyId(c.id);
    try {
      await callAction("setStoreCustomerStatusAction", c.id, status);
      success();
      patchList((prev) => ({ ...prev, customers: prev.customers.map((r) => (r.id === c.id ? { ...r, status } : r)) }));
      Alert.alert(status === "disabled" ? "Account disabled" : "Account re-enabled");
    } catch (e) {
      Alert.alert("Couldn't update the customer", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(c: StoreCustomer) {
    setBusyId(c.id);
    try {
      const { tempPassword } = await callAction<{ ok: true; tempPassword: string }>("resetStoreCustomerPasswordAction", c.id);
      success();
      Alert.alert(
        "Temporary password",
        `${tempPassword}\n\nSend this to ${c.name}. It's shown only once. They can sign in with it, then change it in their account.`,
        [
          { text: "Copy", onPress: () => void Clipboard.setStringAsync(tempPassword) },
          { text: "Done", style: "cancel" },
        ],
      );
    } catch (e) {
      Alert.alert("Couldn't reset the password", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(c: StoreCustomer, draft: CustomerDraft) {
    setBusyId(c.id);
    try {
      const { customer } = await callAction<{ ok: true; customer: CustomerDraft & { id: string } }>("updateStoreCustomerAction", c.id, draft);
      success();
      patchList((prev) => ({ ...prev, customers: prev.customers.map((r) => (r.id === c.id ? { ...r, ...customer } : r)) }));
      setEditingId(null);
    } catch (e) {
      Alert.alert("Couldn't save the customer", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: StoreCustomer) {
    setBusyId(c.id);
    try {
      await callAction("deleteStoreCustomerAction", c.id);
      success();
      patchList((prev) => ({
        customers: prev.customers.filter((r) => r.id !== c.id),
        ledger: prev.ledger?.filter((e) => e.accountId !== c.id) ?? null,
      }));
      if (editingId === c.id) setEditingId(null);
    } catch (e) {
      Alert.alert("Couldn't delete the customer", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const confirmDelete = (c: StoreCustomer) => {
    const orders =
      c.orderCount > 0 ? ` Their ${c.orderCount} order${c.orderCount === 1 ? "" : "s"} stay in your Orders, no longer linked to an account.` : "";
    Alert.alert(
      `Delete ${c.name}'s account?`,
      `Their name, email, phone and community profile are removed and they're signed out everywhere.${orders} This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void remove(c) },
      ],
    );
  };

  const confirmReset = (c: StoreCustomer) =>
    Alert.alert(`Reset ${c.name}'s password?`, "You'll get a temporary password to send them. They'll be signed out on every device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", onPress: () => void resetPassword(c) },
    ]);

  const toggle = (c: StoreCustomer) => {
    if (c.status === "disabled") return void setStatus(c, "active");
    Alert.alert(`Disable ${c.name}'s account?`, "They'll be signed out and can't sign in until you re-enable it.", [
      { text: "Cancel", style: "cancel" },
      { text: "Disable", style: "destructive", onPress: () => void setStatus(c, "disabled") },
    ]);
  };

  const q = query.trim();
  const header = (
    <View style={{ gap: SPACE.xl, marginBottom: SPACE.md }}>
      <MembersOnlyCard />
      <AppText variant="caption" color="muted">
        {hasLedger
          ? "Who buys, how much, and how often, from shoppers with an account on your store."
          : "Shoppers with an account on your store. Guest checkout still works for everyone else."}
      </AppText>
      {hasLedger && ledger && accounts.length > 0 ? (
        <View style={{ gap: SPACE.lg }}>
          <Chips<CustomerPeriod> options={PERIODS.map((p) => ({ key: p.key, label: p.label }))} value={period} onChange={setPeriod} label="Date range" />
          <AccountsInsights
            accounts={accounts}
            ledger={ledger}
            stats={stats}
            period={period}
            now={now}
            money={money}
            moneyShort={moneyShort}
            vipRule={`${money(VIP_SPEND)}+ total spent`}
            onOpenProfile={(id) => router.push({ pathname: "/customer-account/[id]", params: { id } })}
            onFilter={showFilter}
            onOpenPromo={promoAllowed ? () => router.push("/manage/promo") : undefined}
          />
        </View>
      ) : null}
      {accounts.length > 0 ? (
        <View style={{ gap: SPACE.md }} onLayout={(e) => (tableY.current = e.nativeEvent.layout.y)}>
          <SectionHeader eyebrow="Customers" title="All customers" action={{ label: "Export CSV", onPress: exportCsv }} />
          <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name, email or phone" autoCapitalize="none" autoCorrect={false} />
          <Chips<CustomerFilter>
            options={filters.map((f) => ({ key: f, label: CUSTOMER_FILTERS[f].label, count: counts[f] }))}
            value={filter}
            onChange={setFilter}
            label="Filter customers"
          />
          <AppText variant="caption" color="faint">
            {`Showing ${visible.length} of ${accounts.length} customer${accounts.length === 1 ? "" : "s"}`}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Customer accounts" }} />
      <OfflineBanner />
      {list.isPending ? (
        <View style={styles.pending}>
          <MembersOnlyCard />
          <SkeletonList />
        </View>
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          ref={listRef}
          data={visible}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            accounts.length === 0 ? (
              <EmptyState
                icon="people-outline"
                title="No customer accounts yet"
                body="Shoppers can sign up from the account icon in your store's header. They'll show up here."
              />
            ) : (
              <EmptyState
                icon="search"
                title="No matching customers"
                body={q ? `No customers match “${q}”.` : "No customers match this filter."}
              />
            )
          }
          renderItem={({ item: c }) => (
            <CustomerCard
              c={c}
              s={stats.get(c.id)}
              hasLedger={hasLedger}
              canOrders={me.can.orders}
              online={online}
              busyId={busyId}
              editing={editingId === c.id}
              money={money}
              onEdit={() => setEditingId(c.id)}
              onSave={(draft) => void saveEdit(c, draft)}
              onCancelEdit={() => setEditingId(null)}
              onReset={() => confirmReset(c)}
              onToggle={() => toggle(c)}
              onDelete={() => confirmDelete(c)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  pending: { padding: SPACE.lg, gap: SPACE.lg },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: SPACE.lg, rowGap: SPACE.sm },
  fact: { minWidth: 88 },
  editActions: { flexDirection: "row", gap: SPACE.md },
  tabular: { fontVariant: ["tabular-nums"] },
});
