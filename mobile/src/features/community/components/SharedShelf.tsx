import { useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, SectionList, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage, SharedTab, ThreadType } from "@contract";
import { useShared } from "../hooks/useCommunityData";
import { fileTypeLabel, formatBytes } from "../lib/documents";
import { firstName, shortDate } from "../lib/format";
import { chunk, extractLinks, monthSections, type SharedLink } from "../lib/shared";
import { openLink } from "../open";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatEmpty, type IconName } from "./ChatKit";
import { ProductChatCard, ProtocolChatCard } from "./Cards";
import { CHAT_IMAGE_BLURHASH, FileBadge, PhotoViewer } from "./Media";

type ShelfItem = CommunityMessage & { link?: SharedLink };

const GRID_COLUMNS = 3;
const GRID_GAP = 2;

const EMPTY: Record<SharedTab, { icon: IconName; title: string; body: string }> = {
  media: { icon: "images-outline", title: "No photos yet", body: "Photos shared in this chat show up here." },
  docs: { icon: "document-text-outline", title: "No documents yet", body: "Tap + then Document in the chat to share a PDF, Word or Excel file." },
  links: { icon: "link-outline", title: "No links yet", body: "Links sent in this chat show up here." },
  listings: { icon: "pricetags-outline", title: "No listings yet", body: "Products and protocols shared in this chat show up here." },
};

const who = (m: CommunityMessage) => (m.mine ? "You" : firstName(m.sender?.name));

function DocRow({ item }: { item: ShelfItem }) {
  const name = item.file?.name ?? "Document";
  const meta = [fileTypeLabel(item.file?.mime, name), formatBytes(item.file?.size), shortDate(item.createdAt)].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={item.file?.url ? () => void openLink(item.file!.url) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${meta}, from ${who(item)}`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: GUTTER, paddingVertical: 10, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface })}
    >
      <FileBadge type={fileTypeLabel(item.file?.mime, name)} />
      <View style={{ flex: 1 }}>
        <ChatText variant="bodyStrong" numberOfLines={2}>
          {name}
        </ChatText>
        <ChatText variant="footnote" numberOfLines={1}>{`${meta} · ${who(item)}`}</ChatText>
      </View>
      <Ionicons name="open-outline" size={18} color={CHAT.inkFaint} />
    </Pressable>
  );
}

function LinkRow({ item, link }: { item: ShelfItem; link: SharedLink }) {
  const b = useChatBrand();
  const context = item.body?.replace(/\s+/g, " ").trim();
  return (
    <Pressable
      onPress={() => void openLink(link.url)}
      accessibilityRole="link"
      accessibilityLabel={`Link to ${link.host}, from ${who(item)}`}
      style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingHorizontal: GUTTER, paddingVertical: 10, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: b.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="link" size={22} color={b.brandText} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <ChatText variant="bodyStrong" numberOfLines={1}>
          {link.host}
        </ChatText>
        <ChatText numberOfLines={2} style={{ color: CHAT.info, fontSize: 13.5, lineHeight: 18 }}>
          {link.url}
        </ChatText>
        <ChatText variant="footnote" numberOfLines={1}>
          {context && context !== link.url ? `${who(item)}: ${context}` : `${who(item)} · ${shortDate(item.createdAt)}`}
        </ChatText>
      </View>
    </Pressable>
  );
}

/** One shelf of "Media, links and docs", grouped by month like WhatsApp. */
export function SharedShelf({ type, id, tab }: { type: ThreadType; id: string; tab: SharedTab }) {
  const b = useChatBrand();
  const { width } = useWindowDimensions();
  const q = useShared(type, id, tab);
  const [viewing, setViewing] = useState<string | null>(null);
  const tile = Math.floor((width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);

  const sections = useMemo(() => {
    const items = q.data?.items ?? [];
    const months: { title: string; data: ShelfItem[] }[] =
      tab === "links" ? monthSections(items.flatMap((m) => extractLinks(m.body).map((link) => ({ ...m, link })))) : monthSections(items);
    return months.map((s) => ({ title: s.title, data: tab === "media" ? chunk(s.data, GRID_COLUMNS) : s.data.map((d) => [d]) }));
  }, [q.data, tab]);

  const renderRow = ({ item: row }: { item: ShelfItem[] }): ReactElement => {
    if (tab === "media") {
      return (
        <View style={{ flexDirection: "row", gap: GRID_GAP, marginBottom: GRID_GAP }}>
          {row.map((m) =>
            m.image ? (
              <Pressable key={m.id} onPress={() => setViewing(m.image!.url)} accessibilityRole="imagebutton" accessibilityLabel={`Photo from ${who(m)}, ${shortDate(m.createdAt)}`}>
                <Image source={{ uri: m.image.url }} placeholder={{ blurhash: CHAT_IMAGE_BLURHASH }} contentFit="cover" recyclingKey={m.id} style={{ width: tile, height: tile, backgroundColor: CHAT.surfaceAlt }} />
              </Pressable>
            ) : null,
          )}
        </View>
      );
    }
    const item = row[0];
    if (tab === "docs") return <DocRow item={item} />;
    if (tab === "links" && item.link) return <LinkRow item={item} link={item.link} />;
    return (
      <View style={{ paddingHorizontal: GUTTER, paddingVertical: 6 }}>
        {item.kind === "protocol" ? <ProtocolChatCard protocol={item.protocol} /> : <ProductChatCard product={item.product} />}
        <ChatText variant="caption" style={{ marginTop: 4 }}>{`${who(item)} · ${shortDate(item.createdAt)}`}</ChatText>
      </View>
    );
  };

  const empty = EMPTY[tab];
  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={(row, i) => `${row[0]?.id ?? i}-${row[0]?.link?.url ?? ""}`}
        renderItem={renderRow}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: CHAT.surfaceAlt, paddingHorizontal: GUTTER, paddingVertical: 6 }}>
            <ChatText variant="overline" accessibilityRole="header">
              {section.title}
            </ChatText>
          </View>
        )}
        stickySectionHeadersEnabled
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
        ListEmptyComponent={
          q.isPending ? (
            <ActivityIndicator color={b.brandText} style={{ marginTop: 48 }} />
          ) : q.error ? (
            <ChatEmpty icon="cloud-offline-outline" title="Couldn't load" body={q.error.message} />
          ) : (
            <ChatEmpty icon={empty.icon} title={empty.title} body={empty.body} />
          )
        }
      />
      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
