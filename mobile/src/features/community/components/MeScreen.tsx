import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { enablePush } from "@/notifications/push";
import { useAccountPhoto, useSaveAccountProfile } from "@/features/account/useAccountProfile";
import { useSwitchView } from "../useAppView";
import { useCommunityAccess, useInbox } from "../hooks/useInbox";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, IconButton, type IconName } from "./ChatKit";
import { Field, FormError } from "./Form";
import { MembershipScreen } from "./MembershipScreen";
import { RoleBadge } from "./RoleBadge";
import { Sheet } from "./Surfaces";
import { BusinessSwitch } from "./ViewSwitch";

const NAME_MAX = 40;
const NICKNAME_MAX = 24;
const BIO_MAX = 160;

function ListRow({ icon, tint, label, detail, onPress, destructive = false, last = false }: { icon: IconName; tint: string; label: string; detail?: string; onPress: () => void; destructive?: boolean; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface })}
    >
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: tint, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={17} color="#fff" />
      </View>
      <View style={{ flex: 1, minHeight: 52, justifyContent: "center", paddingRight: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: CHAT.hairline }}>
        <ChatText color={destructive ? CHAT.danger : CHAT.ink}>{label}</ChatText>
        {detail ? <ChatText variant="footnote">{detail}</ChatText> : null}
      </View>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, paddingHorizontal: GUTTER }}>
      <ChatText variant="overline" accessibilityRole="header" style={{ marginLeft: 4 }}>
        {title}
      </ChatText>
      <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, overflow: "hidden" }, SHADOWS.hairline]}>{children}</View>
    </View>
  );
}

function EditProfileSheet({ visible, onClose, showBio }: { visible: boolean; onClose: () => void; showBio: boolean }) {
  const { me } = useSignedIn();
  const account = me.account;
  const update = useSaveAccountProfile();
  const photo = useAccountPhoto();
  const [name, setName] = useState(account.name);
  const [nickname, setNickname] = useState(account.nickname ?? "");
  const [bio, setBio] = useState(me.community.profile?.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const preview = nickname.trim() || name.trim() || account.displayName;
  const save = () => {
    if (name.trim().length < 2) {
      setError("Use at least 2 characters for your name.");
      return;
    }
    setError(null);
    update.mutate(
      {
        name: name.trim().slice(0, NAME_MAX),
        nickname: nickname.trim().slice(0, NICKNAME_MAX) || null,
        ...(showBio ? { bio: bio.trim().slice(0, BIO_MAX) } : {}),
      },
      { onSuccess: onClose, onError: (e) => setError(e.message) },
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Edit profile" subtitle={showBio ? "How you appear in every chat" : "Your photo, name and nickname"}>
      <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={photo.choose}
            disabled={photo.busy}
            accessibilityRole="button"
            accessibilityLabel={account.avatarUrl ? "Change profile photo" : "Add a profile photo"}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <Avatar name={preview} hue={me.community.profile?.avatarHue ?? 0} imageUrl={account.avatarUrl} size={84} />
            <View style={{ position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: CHAT.ink, borderWidth: 2, borderColor: CHAT.surface, alignItems: "center", justifyContent: "center" }}>
              {photo.busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
            </View>
          </Pressable>
          {account.avatarUrl ? (
            <Pressable onPress={photo.confirmRemove} disabled={photo.busy} accessibilityRole="button" hitSlop={8}>
              <ChatText variant="footnote" style={{ textDecorationLine: "underline" }}>Remove photo</ChatText>
            </Pressable>
          ) : null}
        </View>
        <Field label="Name" value={name} onChangeText={setName} maxLength={NAME_MAX} counter icon="person-outline" autoCapitalize="words" />
        <Field label="Nickname (optional)" value={nickname} onChangeText={setNickname} maxLength={NICKNAME_MAX} counter icon="happy-outline" autoCapitalize="words" placeholder="Shown instead of your name" />
        {showBio ? <Field label="Bio" value={bio} onChangeText={setBio} maxLength={BIO_MAX} counter multiline placeholder="A line about you (optional)" /> : null}
        <FormError message={error} />
        <ChatButton label="Save changes" size="lg" loading={update.isPending} onPress={save} />
      </ScrollView>
    </Sheet>
  );
}

function Stat({ value, label, onPress }: { value: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 2, minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <ChatText style={{ fontFamily: INTER.bold, fontSize: 17, lineHeight: 22 }}>{value}</ChatText>
      <ChatText variant="caption">{label}</ChatText>
    </Pressable>
  );
}

/** Where the profile's Chats links go: the customer tab, or the admin's community view. */
const CHATS_HREF = { member: "/community", moderator: "/community-view" } as const;

function MemberProfile({ variant = "member" }: { variant?: "member" | "moderator" }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const inbox = useInbox();
  const [editing, setEditing] = useState(false);
  const switchView = useSwitchView();
  const profile = me.community.profile;
  const name = me.account.displayName;
  const liveDrops = inbox.data?.drops.filter((d) => d.isActive).length ?? 0;
  const moderator = variant === "moderator";
  const communityAdmin = !moderator && me.community.isAdmin === true;
  const verifiedReseller = !moderator && me.community.isVerifiedReseller === true;
  const chatsHref = CHATS_HREF[variant];
  const pending = me.community.pendingApplications;

  const turnOnAlerts = async () => {
    const res = await enablePush({ newOrders: moderator && me.can.orders, storeName: me.store.name });
    Alert.alert(res.ok ? "Notifications on" : "Notifications are off", res.ok ? "You'll hear about new DMs and product drops." : res.message);
  };
  const confirmSignOut = () =>
    Alert.alert("Sign out?", `Notifications from ${me.store.name} stop on this phone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <LinearGradient colors={[b.brand, b.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 8, paddingHorizontal: GUTTER, paddingBottom: 56 }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            {moderator ? <BusinessSwitch /> : null}
            <IconButton name="create-outline" label="Edit profile" color={b.onBrand} onPress={() => setEditing(true)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ borderWidth: 3, borderColor: "rgba(255,255,255,0.85)", borderRadius: 44 }}>
              <Avatar name={name} hue={profile?.avatarHue ?? 0} imageUrl={me.account.avatarUrl} size={76} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <ChatText variant="title" color={b.onBrand} numberOfLines={1} accessibilityRole="header" style={{ fontSize: 22, lineHeight: 27 }}>
                {name}
              </ChatText>
              <ChatText variant="footnote" color={b.onBrand} numberOfLines={1}>
                {me.actor.email}
              </ChatText>
              {communityAdmin || verifiedReseller ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {communityAdmin ? <RoleBadge role="admin" surface="brand" /> : null}
                  {verifiedReseller ? <RoleBadge role="reseller" surface="brand" /> : null}
                </View>
              ) : null}
            </View>
          </View>
          {profile?.bio ? (
            <ChatText variant="callout" color={b.onBrand} style={{ marginTop: 12 }}>
              {profile.bio}
            </ChatText>
          ) : null}
        </LinearGradient>

        <View style={{ marginTop: -36, paddingHorizontal: GUTTER }}>
          <View style={[{ flexDirection: "row", backgroundColor: CHAT.surface, borderRadius: RADII.lg, paddingVertical: 10 }, SHADOWS.hairline]}>
            <Stat value={String(inbox.data?.unreadChats ?? 0)} label="Unread chats" onPress={() => router.navigate(chatsHref)} />
            <View style={{ width: 1, backgroundColor: CHAT.hairline, marginVertical: 4 }} />
            <Stat value={String(liveDrops)} label={liveDrops === 1 ? "Live drop" : "Live drops"} onPress={() => router.navigate(chatsHref)} />
          </View>
        </View>

        <View style={{ gap: 18, marginTop: 20 }}>
          <Section title="Community">
            <ListRow icon="chatbubbles" tint="#6A4BC4" label="Chats" onPress={() => router.navigate(chatsHref)} />
            <ListRow icon="notifications" tint={CHAT.heat} label="Message notifications" detail="DMs and product drops" onPress={() => void turnOnAlerts()} last />
          </Section>
          {moderator ? (
            <Section title="Run your community">
              <ListRow
                icon="person-add"
                tint={CHAT.success}
                label="Members"
                detail={pending ? `${pending} waiting for review` : me.community.joinMode === "open" ? "Open to everyone" : "Review who joins"}
                onPress={() => router.navigate("/community-view/members")}
              />
              <ListRow icon="add-circle" tint={b.brand} label="New channel" onPress={() => router.push("/community/channel-new")} />
              <ListRow icon="pricetags" tint="#B4458C" label="Member tags" detail="Style the Admin and Verified reseller tags" onPress={() => router.push("/community/tags")} />
              <ListRow icon="flash" tint={CHAT.warning} label="Broadcast a drop" detail="Pushes to every member" onPress={() => router.push("/community/drop-new")} last />
            </Section>
          ) : communityAdmin ? (
            <Section title="Help run the community">
              <ListRow
                icon="person-add"
                tint={CHAT.success}
                label="Members"
                detail={pending ? `${pending} waiting for review` : "Approve or remove members"}
                onPress={() => router.push("/community/members")}
              />
              <ListRow icon="add-circle" tint={b.brand} label="New channel" onPress={() => router.push("/community/channel-new")} />
              <ListRow icon="pricetags" tint="#B4458C" label="Member tags" detail="Style the Admin and Verified reseller tags" onPress={() => router.push("/community/tags")} last />
            </Section>
          ) : null}
          <Section title="Account">
            <ListRow icon="person" tint={CHAT.inkMuted} label="Edit profile" onPress={() => setEditing(true)} />
            {moderator ? (
              <ListRow icon="briefcase" tint={CHAT.inkSoft} label="Switch to business view" detail="Orders, products and store tools" onPress={() => switchView("business")} last />
            ) : (
              <>
                <ListRow icon="log-out-outline" tint={CHAT.danger} label="Sign out" destructive onPress={confirmSignOut} />
                <ListRow icon="trash-outline" tint={CHAT.danger} label="Delete account" detail="Removes your account and personal data" destructive onPress={() => router.push("/delete-account")} last />
              </>
            )}
          </Section>
          <ChatText variant="caption" style={{ textAlign: "center" }}>
            {`${me.store.name} · v${Constants.expoConfig?.version ?? "1.0.0"}`}
          </ChatText>
        </View>
      </ScrollView>
      <EditProfileSheet key={editing ? "open" : "closed"} visible={editing} onClose={() => setEditing(false)} showBio={!moderator} />
    </View>
  );
}

/** Customer Me tab: approved members get their profile; everyone else the membership card. */
export function MeScreen() {
  const access = useCommunityAccess();
  return access.membershipCard ? <MembershipScreen card={access.membershipCard} /> : <MemberProfile />;
}

/** Admin community view: the moderator's own profile, community tools, and the way back to business. */
export function ModeratorProfileScreen() {
  return <MemberProfile variant="moderator" />;
}
