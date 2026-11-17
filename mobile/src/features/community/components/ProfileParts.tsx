import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useAccountPhoto, useSaveAccountProfile } from "@/features/account/useAccountProfile";
import { CHAT, GUTTER, RADII, SHADOWS } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, type IconName } from "./ChatKit";
import { Field, FormError } from "./Form";
import { Sheet } from "./Surfaces";

// The Me tab's building blocks, shared by the member profile (MeScreen) and the
// account page shoppers outside the community see (MembershipScreen).

const NAME_MAX = 40;
const NICKNAME_MAX = 24;
const BIO_MAX = 160;

export function ListRow({ icon, tint, label, detail, onPress, destructive = false, last = false }: { icon: IconName; tint: string; label: string; detail?: string; onPress: () => void; destructive?: boolean; last?: boolean }) {
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

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, paddingHorizontal: GUTTER }}>
      <ChatText variant="overline" accessibilityRole="header" style={{ marginLeft: 4 }}>
        {title}
      </ChatText>
      <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, overflow: "hidden" }, SHADOWS.hairline]}>{children}</View>
    </View>
  );
}

export function EditProfileSheet({ visible, onClose, showBio }: { visible: boolean; onClose: () => void; showBio: boolean }) {
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
