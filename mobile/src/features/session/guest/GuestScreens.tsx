import type { ReactNode } from "react";
import { Alert, ScrollView, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { enablePush } from "@/notifications/push";
import { PromoOptInRow } from "@/features/promo/PromoOptIn";
import { ChatButton } from "@/features/community/components/ChatKit";
import { ChatText } from "@/features/community/components/ChatText";
import { ListRow, Section } from "@/features/community/components/ProfileParts";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "@/features/community/theme";
import type { IconName } from "@/ui/primitives";

/**
 * A guest (Continue as guest) shops and orders like anyone, but has no
 * account: the community is locked, and Me is the way to make one. Signing up
 * from here turns the guest into the account — orders and all — and signing in
 * moves the guest's orders onto the existing account (lib/mobile/app-guest.ts).
 */

const LOCK_ICON_SIZE = 34;
const LOCK_BADGE_SIZE = 76;
const PERK_SIZE = 34;

function Perk({ icon, text }: { icon: IconName; text: string }) {
  const b = useChatBrand();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: PERK_SIZE, height: PERK_SIZE, borderRadius: PERK_SIZE / 2, backgroundColor: b.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={17} color={b.brandText} />
      </View>
      <ChatText variant="callout" style={{ flex: 1 }}>
        {text}
      </ChatText>
    </View>
  );
}

function AccountDoors() {
  return (
    <View style={{ gap: 10 }}>
      <ChatButton label="Create a free account" icon="person-add-outline" size="lg" onPress={() => router.push("/create-account")} />
      <ChatButton label="I already have an account" icon="log-in-outline" tone="outline" size="lg" onPress={() => router.push("/sign-in")} />
    </View>
  );
}

function Hero({ icon, title, body, topInset }: { icon: IconName; title: string; body: string; topInset: number }) {
  const b = useChatBrand();
  return (
    <LinearGradient
      colors={[b.brand, b.brandDeep]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ paddingTop: topInset + 28, paddingHorizontal: GUTTER, paddingBottom: 64, alignItems: "center", gap: 12 }}
    >
      <View
        style={{
          width: LOCK_BADGE_SIZE,
          height: LOCK_BADGE_SIZE,
          borderRadius: LOCK_BADGE_SIZE / 2,
          backgroundColor: "rgba(255,255,255,0.18)",
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.55)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={LOCK_ICON_SIZE} color={b.onBrand} />
      </View>
      <ChatText variant="title" color={b.onBrand} accessibilityRole="header" style={{ fontSize: 24, lineHeight: 30, textAlign: "center" }}>
        {title}
      </ChatText>
      <ChatText variant="callout" color={b.onBrand} style={{ textAlign: "center", opacity: 0.92, maxWidth: 320 }}>
        {body}
      </ChatText>
    </LinearGradient>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <View style={{ marginTop: -40, marginHorizontal: GUTTER }}>
      <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 18, gap: 16 }, SHADOWS.card]}>{children}</View>
    </View>
  );
}

/** Chats tab for a guest: what the community is, and the way in. Nothing of it is loaded. */
export function GuestCommunityLock() {
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: CHAT.canvas }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Hero
        icon="lock-closed"
        title="Members only"
        body={`${me.store.name}'s community is for account holders. Create a free account to see the chats.`}
        topInset={insets.top}
      />
      <Card>
        <View style={{ gap: 12 }}>
          <Perk icon="chatbubbles-outline" text="Chat with the store and other shoppers" />
          <Perk icon="flash-outline" text="Hear about product drops and group buys first" />
          <Perk icon="receipt-outline" text="Your guest orders come with you" />
        </View>
        <AccountDoors />
      </Card>
    </ScrollView>
  );
}

/** Me tab for a guest: no profile yet — make an account, keep order alerts, or leave. */
export function GuestMeScreen() {
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const store = me.store.name;
  const hasCommunity = me.community.enabled;

  const turnOnAlerts = async () => {
    const res = await enablePush({ newOrders: false, storeName: store });
    Alert.alert(res.ok ? "Notifications on" : "Notifications are off", res.ok ? `You'll hear from ${store} when your orders move.` : res.message);
  };
  const confirmLeave = () =>
    Alert.alert(
      "Leave guest mode?",
      "Your orders stay with the store, but you won't see them or get updates in this app. Create an account first to keep them.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => void signOut() },
      ],
    );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: CHAT.canvas }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Hero
        icon="person-outline"
        title="You're shopping as a guest"
        body={`Your orders at ${store} are saved to this phone. Create an account to keep them for good.`}
        topInset={insets.top}
      />
      <Card>
        <View style={{ gap: 12 }}>
          <Perk icon="receipt-outline" text="Keep every order you placed as a guest" />
          <Perk icon="phone-portrait-outline" text="Sign in on any phone or on the store's website" />
          {hasCommunity ? <Perk icon="chatbubbles-outline" text={`Join ${store}'s community`} /> : null}
        </View>
        <AccountDoors />
      </Card>
      <View style={{ gap: 18, marginTop: 22 }}>
        <Section title="Guest">
          <ListRow icon="receipt" tint={CHAT.inkSoft} label="My orders" detail="Track what you've ordered" onPress={() => router.navigate("/my-orders")} />
          <ListRow icon="notifications" tint={CHAT.heat} label="Order updates" detail="Get told when your order moves" onPress={() => void turnOnAlerts()} />
          <PromoOptInRow />
          <ListRow icon="log-out-outline" tint={CHAT.danger} label="Leave guest mode" destructive onPress={confirmLeave} last />
        </Section>
        <ChatText variant="caption" style={{ textAlign: "center", fontFamily: INTER.medium }}>
          {`${store} · v${Constants.expoConfig?.version ?? "1.0.0"}`}
        </ChatText>
      </View>
    </ScrollView>
  );
}
