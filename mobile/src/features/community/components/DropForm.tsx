import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CommunityDrop, ProductCard } from "@contract";
import { useCreateDrop } from "../hooks/useCommunityData";
import { useInbox } from "../hooks/useInbox";
import { CHAT, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatButton, Chip } from "./ChatKit";
import { DropCard } from "./Drops";
import { Field, FormCard } from "./Form";
import { ModalHeader } from "./Headers";
import { ProductImage } from "./Media";
import { ProductPicker } from "./ProductPicker";

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "Until ended", minutes: null },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "24 hours", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
];
const SUGGESTIONS = ["Last slots for this batch", "Restocked — grab it", "Closing tonight"];
const HEADLINE_MAX = 80;
const NOTE_MAX = 280;

/** Broadcast a product drop into a channel's General topic (pushes every member). */
export function DropForm({ initialChannel }: { initialChannel?: string }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const inbox = useInbox();
  const create = useCreateDrop();
  const channels = inbox.data?.channels ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [product, setProduct] = useState<ProductCard | null>(null);
  const [headline, setHeadline] = useState("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState<{ minutes: number | null; previewUntil: string | null }>({ minutes: null, previewUntil: null });
  const [channelId, setChannelId] = useState<string | null>(initialChannel ?? null);
  const channel = channelId ?? channels.find((c) => c.postRole === "admins")?.id ?? channels[0]?.id ?? null;

  const preview = useMemo<CommunityDrop | null>(
    () =>
      product
        ? { id: "preview", product, headline: headline.trim() || "Your headline here", note: note.trim() || null, expiresAt: duration.previewUntil, isActive: true, createdAt: "", topicId: "" }
        : null,
    [product, headline, note, duration.previewUntil],
  );

  const valid = !!product && !!channel && headline.trim().length >= 3;
  const submit = () => {
    if (!product || !channel) return;
    create.mutate(
      { productId: product.id, variationId: product.variationId, headline: headline.trim(), note: note.trim(), durationMinutes: duration.minutes, channelId: channel },
      { onSuccess: () => router.back(), onError: (e) => Alert.alert("Couldn't start the drop", e.message) },
    );
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ModalHeader title="Broadcast a drop" eyebrow="Pushes to every member" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 110 }} keyboardShouldPersistTaps="handled">
        <FormCard title="Product">
          <Pressable
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={product ? `Product: ${product.name}. Change` : "Choose the product"}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 10,
              borderRadius: RADII.md,
              borderWidth: 1.5,
              borderStyle: product ? "solid" : "dashed",
              borderColor: product ? CHAT.hairline : b.brandEdge,
              backgroundColor: pressed ? CHAT.surfacePressed : product ? CHAT.surface : b.brandTint,
            })}
          >
            {product ? (
              <>
                <ProductImage uri={product.imageUrl} name={product.name} width={56} height={56} radius={10} />
                <View style={{ flex: 1, gap: 2 }}>
                  <ChatText variant="bodyStrong" numberOfLines={1}>
                    {product.name}
                  </ChatText>
                  <ChatText variant="footnote">{product.priceLabel}</ChatText>
                </View>
                <ChatText variant="subhead" color={b.brandText}>
                  Change
                </ChatText>
              </>
            ) : (
              <>
                <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: b.brandSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="pricetag" size={22} color={b.brandText} />
                </View>
                <ChatText variant="bodyStrong" style={{ flex: 1 }}>
                  Choose the product
                </ChatText>
                <Ionicons name="chevron-forward" size={18} color={CHAT.inkMuted} />
              </>
            )}
          </Pressable>
        </FormCard>

        <FormCard title="Message">
          <Field label="Headline" value={headline} onChangeText={setHeadline} maxLength={HEADLINE_MAX} counter placeholder="e.g. Last 8 slots this week" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} icon="sparkles" label={s} onPress={() => setHeadline(s)} />
            ))}
          </View>
          <Field label="Note" value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline placeholder="Pricing, cutoff, who it's for (optional)" />
        </FormCard>

        <FormCard title="Urgency window">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {DURATIONS.map((d) => (
              <Chip
                key={d.label}
                label={d.label}
                icon={d.minutes ? "time-outline" : "infinite"}
                active={duration.minutes === d.minutes}
                onPress={() => setDuration({ minutes: d.minutes, previewUntil: d.minutes ? new Date(Date.now() + d.minutes * 60_000).toISOString() : null })}
              />
            ))}
          </View>
        </FormCard>

        <FormCard title="Announce in">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {channels.map((c) => (
              <Chip key={c.id} label={`${c.emoji} ${c.name}`} active={channel === c.id} onPress={() => setChannelId(c.id)} />
            ))}
          </View>
          {!channels.length ? <ChatText variant="footnote">Create a channel first — drops are announced in one.</ChatText> : null}
        </FormCard>

        {preview ? (
          <View style={{ gap: 10, alignItems: "center" }}>
            <ChatText variant="overline" style={{ alignSelf: "flex-start", marginLeft: 4 }}>
              Preview · how members see it
            </ChatText>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <DropCard drop={preview} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: insets.bottom + 12, backgroundColor: CHAT.surface, borderTopWidth: 1, borderTopColor: CHAT.hairline }}>
        <ChatButton label="Broadcast to everyone" size="lg" tone="dark" icon="flash" loading={create.isPending} disabled={!valid} onPress={submit} />
      </View>

      <ProductPicker visible={pickerOpen} title="Pick the product" subtitle="Members get a push and a live buy button" onClose={() => setPickerOpen(false)} onPick={setProduct} />
    </KeyboardAvoidingView>
  );
}
