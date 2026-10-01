import { Fragment, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { bubbleImageSize } from "../lib/attachments";
import { hueFromString } from "../lib/color";
import { fileTypeLabel, formatBytes } from "../lib/documents";
import { splitMatches } from "../lib/search";
import { splitLinks } from "../lib/shared";
import { openLink } from "../open";
import { CHAT, INTER, RADII } from "../theme";
import { ChatText, type ChatTextProps } from "./ChatText";
import { IconButton } from "./ChatKit";

export const CHAT_IMAGE_BLURHASH = "L9Q]{,%L~q%M~qxuayj[00j[ayfQ";
const BUBBLE_WIDTH = 240;

// ── Highlighted text: search marks + tappable links ──────────────────────────

type HighlightedTextProps = ChatTextProps & { children: string; highlight?: string; linkColor?: string };

export function HighlightedText({ children, highlight, linkColor, ...rest }: HighlightedTextProps) {
  if (!highlight && !linkColor) return <ChatText {...rest}>{children}</ChatText>;
  const marked = (text: string) =>
    highlight
      ? splitMatches(text, highlight).map((s, i) =>
          s.match ? (
            <Text key={i} style={{ backgroundColor: CHAT.searchHit, color: CHAT.ink }}>
              {s.text}
            </Text>
          ) : (
            s.text
          ),
        )
      : text;
  const segments = linkColor ? splitLinks(children) : [{ text: children }];
  return (
    <ChatText {...rest}>
      {segments.map((s, i) =>
        "url" in s && s.url ? (
          <Text key={i} accessibilityRole="link" onPress={() => void openLink(s.url!)} style={{ color: linkColor, textDecorationLine: "underline" }}>
            {marked(s.text)}
          </Text>
        ) : (
          <Fragment key={i}>{marked(s.text)}</Fragment>
        ),
      )}
    </ChatText>
  );
}

// ── Photos ───────────────────────────────────────────────────────────────────

/** A shared photo on black; tap anywhere or ✕ to close. */
export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={uri !== null} onRequestClose={onClose} animationType="fade" transparent statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)" }} accessibilityViewIsModal>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" style={{ flex: 1 }}>
          {uri ? <Image source={{ uri }} contentFit="contain" style={{ flex: 1 }} accessibilityLabel="Shared photo" /> : null}
        </Pressable>
        <IconButton name="close" label="Close" variant="overlay" onPress={onClose} style={{ position: "absolute", top: insets.top + 8, right: 12 }} />
      </View>
    </Modal>
  );
}

type ChatImageProps = { uri: string; width: number | null; height: number | null; radius: number; uploading?: boolean; onLongPress?: () => void };

/** A photo in a bubble, sized from its own ratio so the thread never jumps; tap for full screen. */
export function ChatImage({ uri, width, height, radius, uploading = false, onLongPress }: ChatImageProps) {
  const [open, setOpen] = useState(false);
  const size = bubbleImageSize(width, height, BUBBLE_WIDTH);
  return (
    <>
      <Pressable
        onPress={uploading ? undefined : () => setOpen(true)}
        onLongPress={onLongPress}
        delayLongPress={280}
        accessibilityRole="imagebutton"
        accessibilityLabel={uploading ? "Photo, uploading" : "Photo, tap to view full screen"}
      >
        <Image
          source={{ uri }}
          placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }}
          contentFit="cover"
          transition={160}
          style={{ ...size, borderRadius: radius, backgroundColor: CHAT.surfaceAlt }}
        />
        {uploading ? (
          <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius }}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </Pressable>
      <PhotoViewer uri={open ? uri : null} onClose={() => setOpen(false)} />
    </>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

/** Badge colour per format, like a file manager: PDF red, sheets green, docs blue. */
const TINT_BY_TYPE: Record<string, string> = {
  PDF: "#C22536",
  DOC: "#1F63D1",
  DOCX: "#1F63D1",
  TXT: "#4E5663",
  XLS: "#1B7F46",
  XLSX: "#1B7F46",
  CSV: "#1B7F46",
  PPT: "#B8521A",
  PPTX: "#B8521A",
};

export function FileBadge({ type, size = 44 }: { type: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: RADII.sm, backgroundColor: TINT_BY_TYPE[type] ?? CHAT.inkMuted, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="document-text" size={size * 0.45} color="#fff" />
      <ChatText allowFontScaling={false} style={{ color: "#fff", fontFamily: INTER.bold, fontSize: size * 0.2, lineHeight: size * 0.24 }}>
        {type.slice(0, 4)}
      </ChatText>
    </View>
  );
}

type FileCardProps = {
  name: string;
  url: string | null;
  size: number | null | undefined;
  mime: string | null | undefined;
  /** Sits on my brand-coloured bubble. */
  mine?: boolean;
  onMineColor?: string;
  pending?: boolean;
  highlight?: string;
  onLongPress?: () => void;
};

/** A document in a bubble: format badge, name and size; tap opens it. */
export function FileCard({ name, url, size, mime, mine = false, onMineColor = "#fff", pending = false, highlight, onLongPress }: FileCardProps) {
  const type = fileTypeLabel(mime, name);
  const meta = [type, formatBytes(size)].filter(Boolean).join(" · ");
  const canOpen = !!url && !pending;
  const fg = mine ? onMineColor : CHAT.ink;
  return (
    <Pressable
      onPress={canOpen ? () => void openLink(url!) : undefined}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}${pending ? ", uploading" : ""}`}
      accessibilityHint={canOpen ? "Opens the document" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        width: BUBBLE_WIDTH,
        padding: 10,
        borderRadius: RADII.md,
        backgroundColor: mine ? "rgba(255,255,255,0.16)" : CHAT.surfaceAlt,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <FileBadge type={type} />
      <View style={{ flex: 1 }}>
        <HighlightedText highlight={highlight} numberOfLines={2} style={{ color: fg, fontFamily: INTER.semibold, fontSize: 14.5, lineHeight: 19 }}>
          {name}
        </HighlightedText>
        <ChatText style={{ color: fg, opacity: 0.8, fontSize: 12.5, lineHeight: 16, marginTop: 2 }}>{meta}</ChatText>
      </View>
      {pending ? <ActivityIndicator size="small" color={fg} /> : <Ionicons name="open-outline" size={18} color={fg} style={{ opacity: 0.8 }} />}
    </Pressable>
  );
}

// ── Product artwork ──────────────────────────────────────────────────────────

/** A product photo, or its initial on a tinted gradient. */
export function ProductImage({ uri, name, width, height, radius = 12 }: { uri: string | null; name: string; width: number; height: number; radius?: number }) {
  if (!uri) {
    const h = hueFromString(name);
    return (
      <LinearGradient
        colors={[`hsl(${h}, 70%, 94%)`, `hsl(${(h + 30) % 360}, 60%, 86%)`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width, height, alignItems: "center", justifyContent: "center", borderRadius: radius }}
      >
        <ChatText allowFontScaling={false} style={{ fontFamily: INTER.bold, fontSize: Math.min(30, height * 0.4), lineHeight: Math.min(36, height * 0.5), color: `hsl(${h}, 45%, 32%)` }}>
          {name.trim().slice(0, 1).toUpperCase()}
        </ChatText>
      </LinearGradient>
    );
  }
  return (
    <Image
      source={{ uri }}
      placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }}
      contentFit="cover"
      transition={180}
      accessibilityLabel={name}
      style={{ width, height, backgroundColor: CHAT.surfaceAlt, borderRadius: radius }}
    />
  );
}
