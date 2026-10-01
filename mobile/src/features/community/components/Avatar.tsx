import { View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Participant } from "@contract";
import { avatarColors } from "../lib/color";
import { initials } from "../lib/format";
import { CHAT, GRADIENTS, INTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

type AvatarProps = {
  name: string;
  hue: number;
  size?: number;
  imageUrl?: string | null;
  /** The store team: a brand ring and a small shield badge. */
  team?: boolean;
};

/** A member's photo, or their initials on a stable pastel. */
export function Avatar({ name, hue, size = 40, imageUrl, team = false }: AvatarProps) {
  const b = useChatBrand();
  const { bg, fg } = avatarColors(hue);
  const ring = team ? { borderWidth: 2, borderColor: b.brand } : null;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          contentFit="cover"
          transition={120}
          style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: CHAT.surfaceAlt }, ring]}
        />
      ) : (
        <View
          style={[
            { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" },
            ring,
          ]}
        >
          <ChatText allowFontScaling={false} style={{ color: fg, fontFamily: INTER.bold, fontSize: size * 0.36, lineHeight: size * 0.44 }}>
            {initials(name)}
          </ChatText>
        </View>
      )}
      {team && size >= 28 ? (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: size * 0.38,
            height: size * 0.38,
            borderRadius: size,
            backgroundColor: b.brand,
            borderWidth: 2,
            borderColor: "#fff",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="shield-checkmark" size={size * 0.2} color={b.onBrand} />
        </View>
      ) : null}
    </View>
  );
}

export function ParticipantAvatar({ person, size }: { person: Participant; size?: number }) {
  return <Avatar name={person.name} hue={person.avatarHue} imageUrl={person.imageUrl} team={person.isTeam} size={size} />;
}

type EmojiAvatarProps = {
  emoji: string;
  hue: number;
  size?: number;
  /** Announcement channels use the dark premium gradient. */
  broadcast?: boolean;
  /** Rounded square (topics) instead of a circle (channels). */
  square?: boolean;
  imageUrl?: string | null;
};

/** A channel or topic avatar: its picture, or its emoji on a soft two-tone gradient. */
export function EmojiAvatar({ emoji, hue, size = 52, broadcast = false, square = false, imageUrl }: EmojiAvatarProps) {
  const radius = square ? size * 0.3 : size / 2;
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: CHAT.surfaceAlt }}
      />
    );
  }
  const h = ((hue % 360) + 360) % 360;
  const stops = broadcast
    ? ([...GRADIENTS.night] as [string, string, ...string[]])
    : ([`hsl(${h}, 80%, 92%)`, `hsl(${(h + 28) % 360}, 72%, 84%)`] as [string, string]);
  return (
    <LinearGradient
      colors={stops}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: radius, alignItems: "center", justifyContent: "center" }}
    >
      <ChatText allowFontScaling={false} style={{ fontSize: size * 0.46, lineHeight: size * 0.58 }}>
        {emoji || "#"}
      </ChatText>
    </LinearGradient>
  );
}
