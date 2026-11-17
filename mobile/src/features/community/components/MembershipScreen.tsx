import { useState, type ReactNode } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { enablePush } from "@/notifications/push";
import { useReapply } from "../hooks/useCommunityData";
import type { MembershipCard } from "../lib/access";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, type IconName } from "./ChatKit";
import { Field, FormError } from "./Form";
import { EditProfileSheet, ListRow, Section } from "./ProfileParts";

const NAME_MAX = 40;

function Card({ children }: { children: ReactNode }) {
  return <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 18, gap: 14 }, SHADOWS.card]}>{children}</View>;
}

function StatusPill({ icon, label, fg, bg }: { icon: IconName; label: string; fg: string; bg: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: bg, paddingHorizontal: 10, height: 28, borderRadius: 14 }}>
      <Ionicons name={icon} size={14} color={fg} />
      <ChatText style={{ fontFamily: INTER.bold, fontSize: 12.5, color: fg }}>{label}</ChatText>
    </View>
  );
}

/** Shopping works whatever the membership says — the way out of every card. */
function ShopButton() {
  return <ChatButton label="Start shopping" icon="storefront-outline" size="lg" onPress={() => router.navigate("/shop")} />;
}

/** Profile, notifications and the account itself — for every shopper, member or not. */
function AccountSection({ onEdit }: { onEdit: () => void }) {
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const store = me.store.name;
  const turnOnAlerts = async () => {
    const res = await enablePush({ newOrders: false, storeName: store });
    Alert.alert(res.ok ? "Notifications on" : "Notifications are off", res.ok ? `You'll hear from ${store} about your orders.` : res.message);
  };
  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You can sign back in any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  return (
    <Section title="Account">
      <ListRow icon="person" tint={CHAT.inkMuted} label="Edit profile" detail="Photo, name and nickname" onPress={onEdit} />
      <ListRow icon="notifications" tint={CHAT.heat} label="Notifications" detail={`Order updates from ${store}`} onPress={() => void turnOnAlerts()} />
      <ListRow icon="log-out-outline" tint={CHAT.danger} label="Sign out" destructive onPress={confirmSignOut} />
      <ListRow icon="trash-outline" tint={CHAT.danger} label="Delete account" detail="Removes your account and personal data" destructive onPress={() => router.push("/delete-account")} last />
    </Section>
  );
}

function PendingCard({ store }: { store: string }) {
  const { reloadMe } = useSession();
  const { me } = useSignedIn();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    await reloadMe();
    setChecking(false);
  };
  return (
    <Card>
      <StatusPill icon="hourglass-outline" label="Pending review" fg={CHAT.warning} bg={CHAT.warningSoft} />
      <ChatText variant="headline">{`Waiting for ${store} to approve you`}</ChatText>
      <ChatText variant="callout">{`Signed in as ${me.actor.email}. The chats open here the moment you're approved. With notifications on, we'll tell you.`}</ChatText>
      <ShopButton />
      <ChatButton label="Check status" tone="outline" loading={checking} onPress={() => void check()} />
    </Card>
  );
}

function RejectedCard({ reason }: { reason: string | null }) {
  const { me } = useSignedIn();
  const reapply = useReapply();
  const [name, setName] = useState(me.community.profile?.displayName ?? me.actor.displayName);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (name.trim().length < 2) {
      setError("Use at least 2 characters for your name.");
      return;
    }
    setError(null);
    reapply.mutate(name.trim(), { onError: (e) => setError(e.message) });
  };
  return (
    <Card>
      <View style={{ backgroundColor: CHAT.dangerSoft, borderRadius: RADII.md, padding: 14, gap: 6, borderLeftWidth: 4, borderLeftColor: CHAT.danger }}>
        <ChatText style={{ fontFamily: INTER.bold, fontSize: 12, letterSpacing: 0.6, color: CHAT.danger }}>REASON FROM THE STORE</ChatText>
        <ChatText>{reason ?? "No reason was given."}</ChatText>
      </View>
      <ChatText variant="headline">Update your details</ChatText>
      <Field label="Display name" icon="person-outline" value={name} onChangeText={setName} maxLength={NAME_MAX} autoCapitalize="words" />
      <FormError message={error} />
      <ChatButton label={me.community.joinMode === "open" ? "Rejoin the community" : "Send for review again"} size="lg" loading={reapply.isPending} onPress={submit} />
      <ChatButton label="Start shopping" icon="storefront-outline" tone="outline" onPress={() => router.navigate("/shop")} />
    </Card>
  );
}

function RevokedCard({ reason }: { reason: string | null }) {
  return (
    <Card>
      <StatusPill icon="remove-circle-outline" label="Access removed" fg={CHAT.danger} bg={CHAT.dangerSoft} />
      <ChatText variant="callout">{reason ?? "The store removed your access to the community."}</ChatText>
      <ChatText variant="footnote">{"You can still shop here and on the store's website. Contact the store if you think this is a mistake."}</ChatText>
      <ShopButton />
    </Card>
  );
}

/** No community to be in (the store hasn't one, or it's off): a plain account page. */
function AccountCard() {
  return (
    <Card>
      <ChatText variant="callout">Shop the catalog and follow every order from here: payment, packing and tracking.</ChatText>
      <ShopButton />
      <ChatButton label="Your orders" icon="receipt-outline" tone="outline" onPress={() => router.navigate("/my-orders")} />
    </Card>
  );
}

const HERO: Record<MembershipCard, { icon: IconName; title: (store: string) => string; body: string }> = {
  none: { icon: "person", title: (s) => `Your ${s} account`, body: "It works here and on the store's website." },
  pending: { icon: "time", title: () => "Your request is in review", body: "The store checks every new member. Chats unlock the moment you're approved." },
  rejected: { icon: "alert-circle", title: () => "Request not approved", body: "The store reviewed your details. See why below, fix them and send it again." },
  revoked: { icon: "lock-closed", title: () => "Community access removed", body: "Your account still works for shopping." },
};

/**
 * The Me tab for customers who aren't approved community members (yet): their
 * membership status (or a plain account page when there's no community), a way
 * to the shop, and the account section — profile, notifications, sign out.
 */
export function MembershipScreen({ card }: { card: MembershipCard }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { me } = useSignedIn();
  const { reloadMe } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const hero = HERO[card];
  const reason = me.community.rejectionReason;
  const onRefresh = async () => {
    setRefreshing(true);
    await reloadMe();
    setRefreshing(false);
  };
  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={b.onBrand} />}
      >
        <LinearGradient colors={[b.brand, b.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 28, paddingHorizontal: GUTTER, paddingBottom: 60, gap: 10 }}>
          {card === "none" ? (
            // A plain account page: the shopper's own face, not a status icon.
            <View style={{ alignSelf: "flex-start", borderWidth: 3, borderColor: "rgba(255,255,255,0.85)", borderRadius: 32 }}>
              <Avatar name={me.account.displayName} hue={me.community.profile?.avatarHue ?? 0} imageUrl={me.account.avatarUrl} size={56} />
            </View>
          ) : (
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={hero.icon} size={28} color={b.onBrand} />
            </View>
          )}
          <ChatText accessibilityRole="header" style={{ color: b.onBrand, fontFamily: INTER.bold, fontSize: 26, lineHeight: 31, letterSpacing: -0.6 }}>
            {hero.title(me.store.name)}
          </ChatText>
          <ChatText variant="callout" color={b.onBrand}>
            {hero.body}
          </ChatText>
        </LinearGradient>
        <View style={{ marginTop: -32, paddingHorizontal: GUTTER, gap: 14 }}>
          {card === "pending" ? (
            <PendingCard store={me.store.name} />
          ) : card === "rejected" ? (
            <RejectedCard reason={reason} />
          ) : card === "revoked" ? (
            <RevokedCard reason={reason} />
          ) : (
            <AccountCard />
          )}
        </View>
        <View style={{ marginTop: 20 }}>
          <AccountSection onEdit={() => setEditing(true)} />
        </View>
      </ScrollView>
      <EditProfileSheet key={editing ? "open" : "closed"} visible={editing} onClose={() => setEditing(false)} showBio={false} />
    </View>
  );
}
