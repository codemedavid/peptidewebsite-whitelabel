import { useState } from "react";
import { Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { setupKeys, success } from "@/features/admin/setup/data";
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
};

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");

/**
 * The website's Customers view (AdminCustomers): shoppers who made an account,
 * with disable (signs them out everywhere), re-enable, and reset password (a
 * temp one for the owner to send a shopper who forgot theirs). Runs the website's own
 * actions, gated on the "customers" permission and the store's feature.
 */
export default function CustomerAccountsScreen() {
  const t = useTheme();
  const online = useOnline();
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const key = [...setupKeys.all(scope), "customer-accounts"];
  const list = useQuery({
    queryKey: key,
    queryFn: async () => (await callAction<{ ok: true; customers: StoreCustomer[] }>("listStoreCustomersAction")).customers,
  });

  async function setStatus(c: StoreCustomer, status: StoreCustomer["status"]) {
    setBusyId(c.id);
    try {
      await callAction("setStoreCustomerStatusAction", c.id, status);
      success();
      qc.setQueryData<StoreCustomer[]>(key, (prev) => prev?.map((r) => (r.id === c.id ? { ...r, status } : r)));
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

  const q = query.trim().toLowerCase();
  const rows = (list.data ?? []).filter((c) => !q || [c.name, c.email, c.phone].some((v) => v.toLowerCase().includes(q)));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Customer accounts" }} />
      <OfflineBanner />
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />}
          ListHeaderComponent={
            <View style={{ gap: SPACE.md, marginBottom: SPACE.md }}>
              <AppText variant="caption" color="muted">
                Shoppers who created an account on your store. Disabling one signs them out everywhere.
              </AppText>
              <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name, email or phone" autoCapitalize="none" autoCorrect={false} />
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon={q ? "search" : "people-outline"}
              title={q ? "No matching customers" : "No customer accounts yet"}
              body={q ? `Nothing found for “${query.trim()}”.` : "When shoppers sign up on your store, they'll show up here."}
            />
          }
          renderItem={({ item: c }) => (
            <Card style={{ gap: SPACE.sm }}>
              <View style={styles.head}>
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  {c.name}
                </AppText>
                <Pill tone={c.status === "active" ? "success" : "danger"} size="sm" label={c.status === "active" ? "Active" : "Disabled"} />
              </View>
              <AppText variant="caption" color="muted">
                {c.phone ? `${c.email} · ${c.phone}` : c.email}
              </AppText>
              <AppText variant="caption" color="faint">
                {`${c.orderCount} order${c.orderCount === 1 ? "" : "s"} · Joined ${shortDate(c.joinedAt)} · Last sign-in ${shortDate(c.lastLoginAt)}`}
              </AppText>
              {c.status === "active" && (
                <Button
                  label="Reset password"
                  variant="secondary"
                  icon="key-outline"
                  disabled={!online || busyId !== null}
                  onPress={() => confirmReset(c)}
                />
              )}
              <Button
                label={c.status === "active" ? "Disable" : "Re-enable"}
                variant={c.status === "active" ? "danger" : "secondary"}
                icon={c.status === "active" ? "ban-outline" : "checkmark-circle-outline"}
                loading={busyId === c.id}
                disabled={!online || (busyId !== null && busyId !== c.id)}
                onPress={() => toggle(c)}
              />
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
