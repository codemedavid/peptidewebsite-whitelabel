import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityMessage, Participant } from "@contract";
import { useReducedMotion } from "../hooks/useMotion";
import { formatDayLabel } from "../lib/format";
import { buildThreadRows, type ThreadRow } from "../lib/grouping";
import type { LocalMessage } from "../lib/messages";
import { CHAT, INTER, SHADOWS, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { MessageBubble } from "./MessageBubble";
import { Wallpaper } from "./Surfaces";

/** Show the jump-to-latest button once this far from the newest message. */
const JUMP_THRESHOLD = 420;
const SCROLL_RETRY_MS = 120;
/** A far-off search hit gets this many measured retries, then we stop trying. */
const MAX_SCROLL_RETRIES = 3;

export type Row = ThreadRow<LocalMessage>;

type Props = {
  /** Newest first. */
  messages: LocalMessage[];
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  listRef: RefObject<FlatList<Row> | null>;
  empty: { emoji: string; title: string; body: string };
  onLongPressMessage: (m: CommunityMessage) => void;
  onPressSender: (p: Participant, m: CommunityMessage) => void;
  hideNames?: boolean;
  onEndDrop?: (dropId: string) => void;
  highlight?: string;
  focusId?: string | null;
};

/** The wallpapered, inverted message list shared by topic and DM screens. */
export function ThreadList({ messages, loading, hasMore, loadingOlder, onLoadOlder, listRef, empty, onLongPressMessage, onPressSender, hideNames = false, onEndDrop, highlight, focusId = null }: Props) {
  const brand = useChatBrand();
  const reduced = useReducedMotion();
  const [showJump, setShowJump] = useState(false);
  const rows = useMemo(() => buildThreadRows(messages), [messages]);
  const landedOn = useRef<string | null>(null);
  const target = useRef<string | null>(null);
  const attempts = useRef(0);
  const failed = useRef(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  /** Scroll to a row; it only counts as landed if the list didn't report a failure. */
  const tryScroll = useCallback(
    (index: number, id: string) => {
      failed.current = false;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: !reduced });
      if (!failed.current) landedOn.current = id;
    },
    [listRef, reduced],
  );

  // Rows can arrive after the focus is set (an older page loading), so retry
  // on every rows change until the hit has been scrolled to once.
  useEffect(() => {
    if (!focusId) {
      landedOn.current = null;
      target.current = null;
      return;
    }
    if (target.current !== focusId) {
      target.current = focusId;
      attempts.current = 0;
    }
    if (landedOn.current === focusId || timers.current.size > 0) return;
    const index = rows.findIndex((r) => r.type === "message" && r.message.id === focusId);
    if (index >= 0) tryScroll(index, focusId);
  }, [focusId, rows, tryScroll]);

  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      failed.current = true;
      const id = target.current;
      if (!id || attempts.current >= MAX_SCROLL_RETRIES) return;
      attempts.current += 1;
      listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
      const t = setTimeout(() => {
        timers.current.delete(t);
        if (target.current === id) tryScroll(index, id);
      }, SCROLL_RETRY_MS);
      timers.current.add(t);
    },
    [listRef, tryScroll],
  );

  return (
    <View style={{ flex: 1 }}>
      <Wallpaper />
      <FlatList
        ref={listRef}
        data={rows}
        inverted
        keyExtractor={(row) => (row.type === "day" ? row.id : row.message.clientId ? `c-${row.message.clientId}` : row.message.id)}
        contentContainerStyle={{ paddingVertical: 10, flexGrow: 1 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={hasMore ? onLoadOlder : undefined}
        onScroll={(e) => setShowJump(e.nativeEvent.contentOffset.y > JUMP_THRESHOLD)}
        scrollEventThrottle={100}
        onScrollToIndexFailed={onScrollToIndexFailed}
        ListFooterComponent={hasMore || loadingOlder ? <ActivityIndicator color={brand.brandText} style={{ marginVertical: 12 }} accessibilityLabel="Loading older messages" /> : null}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={brand.brandText} style={{ marginTop: 40 }} accessibilityLabel="Loading messages" />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", transform: [{ scaleY: -1 }], padding: 32 }}>
              <View style={[{ backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 20, padding: 22, alignItems: "center", gap: 6, maxWidth: 280 }, SHADOWS.card]}>
                <ChatText allowFontScaling={false} style={{ fontSize: 44, lineHeight: 52 }}>
                  {empty.emoji}
                </ChatText>
                <ChatText variant="headline">{empty.title}</ChatText>
                <ChatText variant="callout" style={{ textAlign: "center", color: CHAT.inkMuted }}>
                  {empty.body}
                </ChatText>
              </View>
            </View>
          )
        }
        renderItem={({ item }) =>
          item.type === "day" ? (
            <View style={{ alignItems: "center", marginVertical: 10 }} accessibilityRole="header">
              <View style={{ backgroundColor: CHAT.pill, paddingHorizontal: 11, paddingVertical: 4, borderRadius: 12 }}>
                <ChatText variant="caption" color="#fff" style={{ fontFamily: INTER.semibold, fontSize: 12 }}>
                  {formatDayLabel(item.iso)}
                </ChatText>
              </View>
            </View>
          ) : (
            <MessageBubble
              message={item.message}
              brand={brand}
              startsGroup={item.startsGroup}
              endsGroup={item.endsGroup}
              onLongPress={onLongPressMessage}
              onEndDrop={onEndDrop}
              onPressSender={onPressSender}
              hideName={hideNames}
              highlight={highlight}
              focused={item.message.id === focusId}
            />
          )
        }
      />
      {showJump ? (
        <Pressable
          onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: !reduced })}
          accessibilityRole="button"
          accessibilityLabel="Jump to latest message"
          style={[{ position: "absolute", right: 12, bottom: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: CHAT.surface, alignItems: "center", justifyContent: "center" }, SHADOWS.float]}
        >
          <Ionicons name="chevron-down" size={22} color={CHAT.inkSoft} />
        </Pressable>
      ) : null}
    </View>
  );
}
