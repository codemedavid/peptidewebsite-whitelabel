import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityTagDesign, CommunityTagRole } from "@contract";
import { useCommunityTags } from "../hooks/useCommunityData";
import { tagLook, type TagSurface } from "../lib/tagLook";
import { useChatBrand } from "../theme";
import { ChatText } from "./ChatText";

export type { CommunityTagRole };

type RoleBadgeProps = {
  role: CommunityTagRole;
  /** "brand" = on the coloured profile band. */
  surface?: TagSurface;
  size?: "sm" | "md";
  /** A draft look (the tag editor's preview) instead of the store's saved one. */
  design?: CommunityTagDesign;
};

/** A member's community tag, dressed the way the store chose (Member tags). */
export function RoleBadge({ role, surface = "light", size = "sm", design }: RoleBadgeProps) {
  const tags = useCommunityTags();
  const b = useChatBrand();
  const d = design ?? tags[role];
  const look = tagLook(d, b.brand, surface);
  const md = size === "md";
  return (
    <View
      accessible
      accessibilityLabel={d.label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: md ? 4 : 3,
        paddingHorizontal: md ? 10 : 7,
        paddingVertical: md ? 4 : 2,
        borderRadius: look.radius,
        backgroundColor: look.bg,
        borderWidth: look.borderWidth,
        borderColor: look.border,
      }}
    >
      {d.icon ? <Ionicons name={d.icon} size={md ? 13 : 11} color={look.fg} /> : null}
      <ChatText variant="caption" color={look.fg} numberOfLines={1} style={md ? { fontSize: 13, lineHeight: 17 } : undefined}>
        {d.label}
      </ChatText>
    </View>
  );
}

/** Every tag a person holds, admin first, wrapping onto a second line if needed. */
export function RoleBadges({ roles, surface, size, gap = 6 }: { roles: CommunityTagRole[]; surface?: TagSurface; size?: "sm" | "md"; gap?: number }) {
  if (roles.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {roles.map((r) => (
        <RoleBadge key={r} role={r} surface={surface} size={size} />
      ))}
    </View>
  );
}
