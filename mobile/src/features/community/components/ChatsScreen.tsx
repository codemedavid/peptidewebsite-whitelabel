import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, ScrollView, View } from "react-native";
import { router, type Href } from "expo-router";
import type { CommunityChannel, SearchHit } from "@contract";
import { useChannelMutations } from "../hooks/useCommunityData";
import { useCommunityAccess, useInbox } from "../hooks/useInbox";
import { useMessageSearch } from "../hooks/useSearch";
import { buildChatRows, matchChatsByName, type ChatListRow, type Folder } from "../lib/inbox";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { ChatButton, ChatEmpty, Fab, SearchBar } from "./ChatKit";
import { ChannelRowItem, DirectRowItem, ListSection, MessageHitRow } from "./ChatRows";
import { DropStory } from "./Drops";
import { LargeHeader } from "./Headers";
import { ShopRail } from "./ShopRail";
import { SegmentedTabs } from "./Surfaces";

type Row = ChatListRow | { kind: "section"; title: string } | { kind: "message"; hit: SearchHit };

const rowKey = (r: Row) =>
  r.kind === "channel" ? `c-${r.channel.id}` : r.kind === "direct" ? `d-${r.conversation.id}` : r.kind === "section" ? `s-${r.title}` : `m-${r.hit.message.id}`;

/** Long-press on a channel (moderators): edit or delete. */
function useChannelMenu() {
  const { mutate: removeChannel } = useChannelMutations().remove;
  return useCallback(
    (channel: CommunityChannel) =>
    Alert.alert(channel.name, undefined, [
      { text: "Edit channel", onPress: () => router.push({ pathname: "/community/channel-edit", params: { id: channel.id } }) },
      {
        text: "Delete channel",
        style: "destructive",
        onPress: () =>
          Alert.alert(`Delete ${channel.name}?`, "Every topic and message in it is removed for everyone. This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => removeChannel(channel.id, { onError: (e) => Alert.alert("Couldn't delete", e.message) }) },
          ]),
      },
      { text: "Cancel", style: "cancel" },
    ]),
    [removeChannel],
  );
}

/**
 * The Chats tab: search, drop stories, the store's products, Telegram folders,
 * channels and DMs. `shopHref` is where the product row's "See all" goes
 * (default: the shop's own home for whoever is signed in).
 */
export function ChatsScreen({ inTabHeader = false, headerRight, shopHref }: { inTabHeader?: boolean; headerRight?: ReactNode; shopHref?: Href }) {
  const b = useChatBrand();
  const access = useCommunityAccess();
  const inbox = useInbox();
  const menu = useChannelMenu();
  const [folder, setFolder] = useState<Folder>("all");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const search = useMessageSearch(query, { scope: "everywhere" });
  const data = inbox.data;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    if (query.trim()) {
      const chats = matchChatsByName(data, query);
      const hits: Row[] = search.hits.map((hit) => ({ kind: "message", hit }));
      if (!hits.length) return chats;
      return [...(chats.length ? [{ kind: "section", title: "Chats" } as Row, ...chats] : []), { kind: "section", title: "Messages" }, ...hits];
    }
    return buildChatRows(data, folder);
  }, [data, folder, query, search.hits]);

  const onRefresh = async () => {
    setRefreshing(true);
    await inbox.refetch();
    setRefreshing(false);
  };

  const drops = data?.drops.filter((d) => d.isActive) ?? [];
  const showRail = !query && folder === "all" && drops.length > 0;
  const showShop = !query && folder === "all";

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.surface }}>
      <LargeHeader title="Chats" flush noInset={inTabHeader} right={headerRight}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search chats and messages" />
      </LargeHeader>
      {!query ? (
        <SegmentedTabs<Folder>
          value={folder}
          onChange={setFolder}
          items={[
            { key: "all", label: "All" },
            { key: "unread", label: "Unread", count: data?.unreadChats },
            { key: "direct", label: "Direct" },
            { key: "groups", label: "Groups" },
            { key: "announcements", label: "Announcements" },
          ]}
        />
      ) : null}

      {inbox.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 40 }} accessibilityLabel="Loading chats" />
      ) : inbox.error && !data ? (
        <ChatEmpty icon="cloud-offline-outline" title="Couldn't load chats" body={inbox.error.message} action={<ChatButton label="Try again" tone="outline" onPress={() => void inbox.refetch()} />} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 110, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={b.brandText} />}
          ListHeaderComponent={
            <>
              {showRail ? (
                <View style={{ borderBottomWidth: 1, borderBottomColor: CHAT.hairline }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER - 4, paddingVertical: 12, gap: 8 }}>
                    {drops.map((d) => (
                      <DropStory key={d.id} drop={d} />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {showShop ? <ShopRail seeAllHref={shopHref} /> : null}
            </>
          }
          ListEmptyComponent={
            query ? (
              search.searching ? (
                <ActivityIndicator color={b.brandText} style={{ marginTop: 32 }} />
              ) : search.error ? (
                <ChatEmpty icon="cloud-offline-outline" title="Search unavailable" body={search.error} />
              ) : (
                <ChatEmpty icon="search" title="No results" body={`No chats or messages match “${query.trim()}”.`} />
              )
            ) : folder === "direct" ? (
              <ChatEmpty icon="person-circle-outline" title="No direct messages yet" body="Tap someone's photo or name in any chat, then Message to start a private conversation." />
            ) : folder === "unread" ? (
              <ChatEmpty icon="checkmark-done-circle-outline" title="You're all caught up" body="New messages from every channel show here." />
            ) : (
              <ChatEmpty icon="chatbubbles-outline" title="No chats yet" body={access.moderator ? "Open the first channel with the pencil button." : "Channels appear here as soon as the store opens one."} />
            )
          }
          renderItem={({ item }) => {
            if (item.kind === "section") return <ListSection title={item.title} />;
            if (item.kind === "message") return <MessageHitRow hit={item.hit} query={search.query} />;
            if (item.kind === "direct") return <DirectRowItem conversation={item.conversation} />;
            return <ChannelRowItem channel={item.channel} onMenu={menu} />;
          }}
        />
      )}
      {access.moderator ? <Fab icon="create-outline" label="New channel" onPress={() => router.push("/community/channel-new")} /> : null}
    </View>
  );
}
