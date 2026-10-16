import { View } from "react-native";
import { bubbleImageSize } from "../lib/attachments";
import { playableVideoUrl } from "../lib/media";
import { CHAT } from "../theme";
import type { ChatVideoProps } from "./ChatVideo";

/** Web build: the browser's own player, inline in the bubble. */
export function ChatVideo({ video, radius, width = 240 }: ChatVideoProps) {
  const size = bubbleImageSize(video.width, video.height, width);
  return (
    <View style={{ ...size, borderRadius: radius, overflow: "hidden", backgroundColor: CHAT.night }}>
      <video
        src={playableVideoUrl(video)}
        poster={video.posterUrl ?? undefined}
        controls
        playsInline
        preload={video.posterUrl ? "none" : "metadata"}
        aria-label="Video"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", background: "#000" }}
      />
    </View>
  );
}
