import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { customersApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { Avatar, SEGMENT_META } from "@/features/customers/CustomerRowItem";
import { OrderCard } from "@/features/orders/OrderCard";
import { formatWhen } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Panel, SectionHeader, StatTile } from "@/ui/kit";
import { AppText, Pill, type IconName } from "@/ui/primitives";

const KEY_RE = /^[a-f0-9]{20}$/;

function ContactButton({ icon, label, url }: { icon: IconName; label: string; url: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={({ pressed }) => [
        styles.contact,
        { borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface },
      ]}
    >
      <Ionicons name={icon} size={18} color={t.brand.link} />
      <AppText variant="label" color="link">
        {label}
      </AppText>
    </Pressable>
  );
}

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.detail}>
      <Ionicons name={icon} size={18} color={t.colors.textFaint} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color="faint">
          {label}
        </AppText>
        <AppText variant="body" selectable>
          {value}
        </AppText>
      </View>
    </View>
  );
}

export default function CustomerDetail() {
  const t = useTheme();
  const { scope } = useSignedIn();
  const { key } = useLocalSearchParams<{ key: string }>();
  const valid = typeof key === "string" && KEY_RE.test(key);
  const q = useQuery({
    queryKey: qk.customer(scope, key ?? ""),
    queryFn: () => customersApi.get(key as string),
    enabled: valid,
  });

  if (!valid) return <ErrorState message="This customer link isn't valid." />;
  if (q.isPending) return <SkeletonList rows={4} />;
  if (q.isError || !q.data) {
    return <ErrorState message={q.error?.message ?? "Couldn't load this customer."} onRetry={() => void q.refetch()} />;
  }

  const { customer: c, favourites, orders } = q.data;
  const seg = SEGMENT_META[c.segment];
  const phone = c.phone.replace(/[^\d+]/g, "");

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: c.name }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      >
        <View style={styles.hero}>
          <Avatar name={c.name} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="title" numberOfLines={2} accessibilityRole="header">
              {c.name}
            </AppText>
            <View style={styles.pills}>
              <Pill tone={seg.tone} icon={seg.icon} label={seg.label} size="sm" />
              {c.lapsed ? <Pill tone="warning" icon="moon-outline" label="Inactive 60d+" size="sm" /> : null}
            </View>
          </View>
        </View>

        <View style={styles.grid}>
          <StatTile icon="wallet-outline" label="Total spent" value={c.spentLabel} />
          <StatTile icon="receipt-outline" label="Orders" value={String(c.orders)} />
          <StatTile icon="pricetag-outline" label="Avg. order" value={c.avgLabel} />
          <StatTile icon="calendar-outline" label="Last order" value={formatWhen(c.lastAt)} />
        </View>

        {phone || c.email ? (
          <View style={styles.contacts}>
            {phone ? <ContactButton icon="call-outline" label="Call" url={`tel:${phone}`} /> : null}
            {phone ? <ContactButton icon="chatbubble-outline" label="Text" url={`sms:${phone}`} /> : null}
            {c.email ? <ContactButton icon="mail-outline" label="Email" url={`mailto:${c.email}`} /> : null}
          </View>
        ) : null}

        <Panel style={{ gap: SPACE.md }}>
          {c.email ? <Detail icon="mail-outline" label="Email" value={c.email} /> : null}
          {c.phone ? <Detail icon="call-outline" label="Phone" value={c.phone} /> : null}
          {c.contactMethod ? <Detail icon="chatbubbles-outline" label="Prefers" value={c.contactMethod} /> : null}
          {c.lastAddress ? <Detail icon="location-outline" label="Ships to" value={c.lastAddress} /> : null}
          <Detail icon="time-outline" label="Customer since" value={formatWhen(c.firstAt)} />
        </Panel>

        {favourites.length > 0 ? (
          <View>
            <SectionHeader eyebrow="Favourites" title="What they buy" />
            <Panel style={{ gap: SPACE.sm }}>
              {favourites.map((f) => (
                <View key={f.name} style={styles.fav}>
                  <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {f.name}
                  </AppText>
                  <AppText variant="label" color="muted" style={styles.tabular}>
                    {`×${f.units}`}
                  </AppText>
                </View>
              ))}
            </Panel>
          </View>
        ) : null}

        <View>
          <SectionHeader eyebrow="History" title={`${orders.length} ${orders.length === 1 ? "order" : "orders"}`} />
          <View style={{ gap: SPACE.md }}>
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.xl, paddingBottom: SPACE.xxxl },
  hero: { flexDirection: "row", alignItems: "center", gap: SPACE.lg },
  pills: { flexDirection: "row", gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  contacts: { flexDirection: "row", gap: SPACE.sm },
  contact: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  detail: { flexDirection: "row", gap: SPACE.md },
  fav: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  tabular: { fontVariant: ["tabular-nums"] },
});
