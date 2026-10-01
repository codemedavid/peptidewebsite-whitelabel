import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ProtocolCard } from "@contract";
import { useProtocols } from "../hooks/useCommunityData";
import { hueFromString } from "../lib/color";
import { CHAT, GUTTER, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatEmpty, SearchBar } from "./ChatKit";
import { Sheet } from "./Surfaces";

type Props = { visible: boolean; onClose: () => void; onPick: (p: ProtocolCard) => void };

function detailOf(p: ProtocolCard): string {
  if (p.mode === "image") return "Image guide";
  if (p.mode === "file") return "Guide file";
  return [p.dose, p.frequency].filter(Boolean).join(" · ") || "Dosing guide";
}

/** The clipboard badge the protocol card uses, as a square tile. */
function ProtocolBadge({ name, size = 52 }: { name: string; size?: number }) {
  const h = hueFromString(name);
  return (
    <View style={{ width: size, height: size, borderRadius: RADII.md, backgroundColor: `hsl(${h}, 62%, 92%)`, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name="clipboard" size={size * 0.42} color={`hsl(${h}, 45%, 30%)`} />
    </View>
  );
}

/** Searchable protocol guides in a sheet → tap one to share it as a guide card. */
export function ProtocolPicker({ visible, onClose, onPick }: Props) {
  const b = useChatBrand();
  const q = useProtocols(visible);
  const [query, setQuery] = useState("");
  const protocols = q.data;
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = protocols ?? [];
    return needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all;
  }, [protocols, query]);

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title="Share a protocol" subtitle="It lands in the chat as a guide card anyone can open">
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 10 }}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search protocols" />
      </View>
      {q.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 32 }} accessibilityLabel="Loading protocols" />
      ) : q.error ? (
        <ChatEmpty icon="cloud-offline-outline" title="Couldn't load protocols" body={q.error.message} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <ChatEmpty
              icon={query ? "search" : "clipboard-outline"}
              title={query ? "No matches" : "No protocols yet"}
              body={query ? "Try a shorter name." : "The store hasn't published a protocol guide."}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onPick(item);
                close();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Share the ${item.name} protocol`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 10,
                paddingHorizontal: GUTTER,
                backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
                borderBottomWidth: 1,
                borderBottomColor: CHAT.hairline,
              })}
            >
              <ProtocolBadge name={item.name} />
              <View style={{ flex: 1, gap: 2 }}>
                <ChatText variant="bodyStrong" numberOfLines={1}>
                  {item.name}
                </ChatText>
                <ChatText variant="footnote" numberOfLines={1}>
                  {detailOf(item)}
                </ChatText>
              </View>
              <Ionicons name="add-circle" size={24} color={b.brandText} />
            </Pressable>
          )}
        />
      )}
    </Sheet>
  );
}
