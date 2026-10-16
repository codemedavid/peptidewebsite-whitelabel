import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { VideoAttachment } from "@contract";
import { bubbleImageSize } from "../lib/attachments";
import { formatBytes } from "../lib/documents";
import { playableVideoUrl } from "../lib/media";
import { openVideo } from "../open";
import { CHAT, INTER } from "../theme";
import { CHAT_IMAGE_BLURHASH } from "./Media";
import { ChatText } from "./ChatText";

export type ChatVideoProps = {
  video: Pick<VideoAttachment, "url" | "posterUrl" | "width" | "height" | "size">;
  radius: number;
  width?: number;
  onLongPress?: () => void;
};

const PLAY = 56;

/**
 * A video in a bubble: its still frame (or a dark tile) with a play button,
 * sized from the video's own ratio. Tap plays it full screen in the system
 * player. The web build plays it inline (ChatVideo.web.tsx).
 */
export function ChatVideo({ video, radius, width = 240, onLongPress }: ChatVideoProps) {
  const size = bubbleImageSize(video.width, video.height, width);
  const label = video.size > 0 ? `Video, ${formatBytes(video.size)}` : "Video";
  return (
    <Pressable
      onPress={() => void openVideo(playableVideoUrl(video))}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityLabel={`${label}, tap to play`}
      style={{ ...size, borderRadius: radius, overflow: "hidden", backgroundColor: CHAT.night }}
    >
      {video.posterUrl ? (
        <Image
          source={{ uri: video.posterUrl }}
          placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }}
          contentFit="cover"
          transition={160}
          style={{ position: "absolute", inset: 0 }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.18)" }}>
        <View
          style={{
            width: PLAY,
            height: PLAY,
            borderRadius: PLAY / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(15,17,21,0.55)",
            borderWidth: 1.5,
            borderColor: "rgba(255,255,255,0.85)",
          }}
        >
          <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          left: 8,
          bottom: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 7,
          paddingVertical: 3,
          borderRadius: 10,
          backgroundColor: "rgba(15,17,21,0.55)",
        }}
      >
        <Ionicons name="videocam" size={12} color="#fff" />
        <ChatText style={{ color: "#fff", fontFamily: INTER.semibold, fontSize: 11.5, lineHeight: 14 }}>{label}</ChatText>
      </View>
    </Pressable>
  );
}
