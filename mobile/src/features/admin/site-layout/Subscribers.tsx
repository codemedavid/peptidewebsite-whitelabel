// The newsletter subscriber list (web: SubscriberList in panels-home.tsx):
// listNewsletterSubscribersAction + unsubscribeNewsletterAction, plus the
// "Download CSV" export — on a phone, the CSV goes to the share sheet.

import { Alert, Share, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { IconButton } from "@/features/admin/catalog/components";
import { setupKeys } from "@/features/admin/setup/data";
import { SPACE } from "@/theme/tokens";
import { AppText, Button, Divider } from "@/ui/primitives";

type NewsletterSubscriber = { id: string; email: string; subscribedAt: string };
type ListResult = { subscribers: NewsletterSubscriber[] } | { error: string };

const SHOWN_MAX = 50;

const subscriberKey = (scope: string) => [...setupKeys.all(scope), "newsletter-subscribers"] as const;

function toCsv(rows: readonly NewsletterSubscriber[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["email,subscribed_at", ...rows.map((r) => `${esc(r.email)},${esc(r.subscribedAt)}`)].join("\n");
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

export function Subscribers() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = subscriberKey(scope);
  const list = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await adminBridge.call<ListResult>("listNewsletterSubscribersAction")).subscribers,
  });
  const unsubscribe = useMutation({
    mutationFn: async (id: string) => unwrap(await adminBridge.call<{ ok: true } | { error: string }>("unsubscribeNewsletterAction", id)),
    onSuccess: (_res, id) => qc.setQueryData<NewsletterSubscriber[]>(key, (cur) => (cur ? cur.filter((r) => r.id !== id) : cur)),
    onError: (e) => Alert.alert("Couldn't unsubscribe", e.message),
  });

  const confirmRemove = (r: NewsletterSubscriber) =>
    Alert.alert(`Unsubscribe ${r.email}?`, "They won't get newsletter emails any more.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unsubscribe", style: "destructive", onPress: () => unsubscribe.mutate(r.id) },
    ]);

  const exportCsv = async (rows: readonly NewsletterSubscriber[]) => {
    try {
      await Share.share({ title: "newsletter-subscribers.csv", message: toCsv(rows) });
    } catch {
      Alert.alert("Couldn't share", "Please try again.");
    }
  };

  if (list.isError) {
    return (
      <View style={{ gap: SPACE.sm }}>
        <AppText variant="caption" color="muted">
          {list.error?.message || "Couldn't load subscribers."}
        </AppText>
        <Button label="Try again" variant="secondary" onPress={() => void list.refetch()} />
      </View>
    );
  }
  if (!list.data) {
    return (
      <AppText variant="caption" color="muted">
        Loading subscribers…
      </AppText>
    );
  }
  const rows = list.data;
  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {`${rows.length} subscriber${rows.length === 1 ? "" : "s"}`}
        </AppText>
        {rows.length > 0 ? <Button label="Export CSV" icon="share-outline" variant="secondary" onPress={() => void exportCsv(rows)} /> : null}
      </View>
      {rows.length === 0 ? (
        <AppText variant="caption" color="muted">
          No sign-ups yet. They appear here as soon as someone subscribes.
        </AppText>
      ) : (
        rows.slice(0, SHOWN_MAX).map((r, i) => (
          <View key={r.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText variant="body" numberOfLines={1} selectable>
                  {r.email}
                </AppText>
                <AppText variant="caption" color="faint">
                  {day(r.subscribedAt)}
                </AppText>
              </View>
              <IconButton icon="close-circle-outline" tone="danger" label={`Unsubscribe ${r.email}`} disabled={unsubscribe.isPending} onPress={() => confirmRemove(r)} />
            </View>
          </View>
        ))
      )}
      {rows.length > SHOWN_MAX ? (
        <AppText variant="caption" color="muted">
          {`Showing the latest ${SHOWN_MAX}. Export the CSV for everyone.`}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.sm },
});
