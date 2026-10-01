import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { accountKeys, callAction, useStaffList } from "@/features/admin/account/data";
import { grantableModules, permissionSummary, type StaffInput, type StaffMember } from "@/features/admin/account/rules";
import { StaffEditor } from "@/features/admin/account/StaffEditor";
import { Notice } from "@/features/admin/account/ui";
import { success, useAdminBrand } from "@/features/admin/setup/data";
import { Loadable } from "@/features/admin/setup/ui";
import { EmptyState, OfflineBanner, useOnline } from "@/ui/feedback";
import { AppText, Button, Card, Pill } from "@/ui/primitives";

type Busy = { id: string } | null;

/**
 * The website's Staff Accounts (AdminStaffList + AdminStaffForm), owner only:
 * every staff member with add / edit / suspend / delete, and per-module
 * permissions. Each change runs the website's own staff action — the owner-only
 * guard, username rules and password hashing all stay on the server.
 */
export default function StaffScreen() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const brand = useAdminBrand();
  const list = useStaffList();
  const online = useOnline();
  const [editing, setEditing] = useState<{ staff: StaffMember | null } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: accountKeys.staff(scope) });

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: StaffInput }) =>
      id ? callAction("updateStaffAction", id, input) : callAction("createStaffAction", input),
    onSuccess: (_r, { id }) => {
      success();
      refresh();
      setEditing(null);
      Alert.alert(id ? "Staff member updated" : "Staff member added");
    },
    onError: (e) => Alert.alert("Couldn't save", e.message),
  });

  async function run(staff: StaffMember, fn: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy({ id: staff.id });
    try {
      await fn();
      success();
      refresh();
      Alert.alert(done);
    } catch (e) {
      Alert.alert("Couldn't update staff", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const toggleStatus = (s: StaffMember) => {
    const next = s.status === "active" ? "suspended" : "active";
    void run(s, () => callAction("setStaffStatusAction", s.id, next), next === "suspended" ? "Staff suspended" : "Staff activated");
  };

  const remove = (s: StaffMember) =>
    Alert.alert(`Delete staff member "${s.fullName}"?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(s, () => callAction("deleteStaffAction", s.id), "Staff member deleted") },
    ]);

  const startAdd = () => setEditing({ staff: null });

  return (
    <>
      <Stack.Screen options={{ title: "Staff accounts" }} />
      <Loadable query={list}>
        {(items) => (
          <View style={{ flex: 1 }}>
            <OfflineBanner />
            <ScrollView
              contentContainerStyle={styles.page}
              refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
            >
              <Notice icon="information-circle-outline">
                <AppText variant="caption">
                  <AppText variant="caption" style={{ fontWeight: "700" }}>
                    How admin sign-in works:
                  </AppText>
                  {
                    " with no staff, the admin login asks for your password only. As soon as you add your first staff member, the login also asks for a username — you sign in as “owner” with your admin password, and each staff member signs in with the username you give them."
                  }
                </AppText>
              </Notice>
              <Button label="Add Staff" icon="person-add-outline" disabled={!online} onPress={startAdd} />
              {items.length === 0 ? (
                <EmptyState
                  icon="people-outline"
                  title="No staff yet"
                  body="Add a staff member to give a teammate limited access to this admin — they'll only see the modules you allow."
                  action={online ? { label: "Add your first staff member", onPress: startAdd } : undefined}
                />
              ) : (
                items.map((s) => (
                  <StaffCard
                    key={s.id}
                    staff={s}
                    disabled={busy?.id === s.id || !online}
                    onEdit={() => setEditing({ staff: s })}
                    onToggle={() => toggleStatus(s)}
                    onDelete={() => remove(s)}
                  />
                ))
              )}
            </ScrollView>
          </View>
        )}
      </Loadable>
      {editing ? (
        <StaffEditor
          key={editing.staff?.id ?? "new"}
          staff={editing.staff}
          modules={brand.data ? grantableModules(brand.data) : []}
          saving={save.isPending}
          onCancel={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing.staff?.id ?? null, input })}
        />
      ) : null}
    </>
  );
}

function StaffCard({
  staff,
  disabled,
  onEdit,
  onToggle,
  onDelete,
}: {
  staff: StaffMember;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const active = staff.status === "active";
  return (
    <Card style={[{ gap: SPACE.md }, active ? null : { opacity: 0.75 }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="heading" numberOfLines={2}>
            {staff.fullName}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={2} selectable>
            {`${staff.email} · @${staff.username}`}
          </AppText>
        </View>
        <Pill
          tone={active ? "success" : "neutral"}
          size="sm"
          icon={active ? "checkmark-circle-outline" : "pause-circle-outline"}
          label={active ? "Active" : "Suspended"}
        />
      </View>
      <AppText variant="label" color={t.colors.textMuted}>
        {permissionSummary(staff.permissions)}
      </AppText>
      <View style={styles.actions}>
        <Button label="Edit" variant="secondary" icon="create-outline" disabled={disabled} onPress={onEdit} style={styles.action} />
        <Button
          label={active ? "Suspend" : "Activate"}
          variant="secondary"
          icon={active ? "pause-outline" : "play-outline"}
          disabled={disabled}
          onPress={onToggle}
          style={styles.action}
        />
        <Button label="Delete" variant="danger" icon="trash-outline" disabled={disabled} onPress={onDelete} style={styles.action} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  action: { flexGrow: 1 },
});
