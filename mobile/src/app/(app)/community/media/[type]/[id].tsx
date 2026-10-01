import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { SharedTab } from "@contract";
import { NavBar } from "@/features/community/components/Headers";
import { SharedShelf } from "@/features/community/components/SharedShelf";
import { SegmentedTabs, type SegmentItem } from "@/features/community/components/Surfaces";
import { CHAT } from "@/features/community/theme";

const TABS: SegmentItem<SharedTab>[] = [
  { key: "media", label: "Media" },
  { key: "docs", label: "Docs" },
  { key: "links", label: "Links" },
  { key: "listings", label: "Listings" },
];

/** WhatsApp's "Media, links and docs" for one topic or DM. */
export default function SharedContentRoute() {
  const { type, id, title } = useLocalSearchParams<{ type: string; id: string; title?: string }>();
  const kind = type === "dm" ? "dm" : "topic";
  const [tab, setTab] = useState<SharedTab>("media");
  return (
    <View style={{ flex: 1, backgroundColor: CHAT.surface }}>
      <NavBar title="Media, links and docs" subtitle={title || undefined} />
      <SegmentedTabs items={TABS} value={tab} onChange={setTab} />
      <SharedShelf key={tab} type={kind} id={id} tab={tab} />
    </View>
  );
}
