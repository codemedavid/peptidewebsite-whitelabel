/**
 * The smaller Today cards:
 *   SuppliesCard   every vial needing attention in one card: empty / use-by /
 *                  run-out day + a plain "Reorder" link into the in-app shop (user-initiated; never "buy more to stay on
 *                  protocol" — App Review 1.4.3, TRACKER.md §6)
 *   CheckInNudge   "How are you feeling today?" when there's no check-in yet
 *   ProtocolStrip  the user's protocols as chips → detail, plus "Add"
 *   SyncStatus     a quiet line while offline / changes wait to sync / some couldn't sync
 */
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TodayView } from "../hooks";
import { formatDay } from "../lib/ids";
import type { Protocol } from "../lib/types";
import { plural } from "./format";
import { vialLeftText } from "./vial-model";
import { Card, Dot, haptic, PressButton, SectionHeader, TText } from "./kit";
import { TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme } from "./theme";

export type LowVialItem = TodayView["lowVials"][number];

/** What a vial needs, in plain words: empty / past its use-by / runs out <day>. */
function vialNote(item: LowVialItem, now: Date): { detail: string; isUrgent: boolean } {
  if (item.isExpired) return { detail: `Past its use-by date${item.expiresOn ? ` (${formatDay(item.expiresOn)})` : ""}`, isUrgent: true };
  const left = vialLeftText(item, now);
  if (left === "Empty") return { detail: "Empty — time to start a new vial", isUrgent: true };
  return { detail: item.runOutDate ? left : `${left} · running low`, isUrgent: false };
}

/**
 * Every vial that needs attention, in ONE card (not a stack of alerts). A row
 * opens that vial; "Reorder" (when the shop sells it) is its own button.
 */
export function SuppliesCard({
  items,
  now,
  productFor,
  onReorder,
  onOpen,
}: {
  items: readonly LowVialItem[];
  now: Date;
  productFor: (item: LowVialItem) => string | null;
  onReorder: (productId: string) => void;
  /** Tap a row → this vial's details (mark finished, add a new one). */
  onOpen: (item: LowVialItem) => void;
}) {
  const th = useTrackerTheme();
  if (items.length === 0) return null;
  return (
    <Card>
      <SectionHeader
        title="Supplies"
        right={<TText variant="meta" color={th.status.low.text}>{items.length === 1 ? "1 vial needs you" : `${items.length} vials need you`}</TText>}
      />
      <View>
        {items.map((item, i) => {
          const name = item.protocol?.name ?? "Vial";
          const note = vialNote(item, now);
          const c = note.isUrgent ? th.status.missed : th.status.low;
          const productId = productFor(item);
          return (
            <View key={item.vial.id} style={[styles.supplyRow, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.line } : null]}>
              <View style={[styles.supplyIcon, { backgroundColor: c.soft }]}>
                <Ionicons name={note.isUrgent ? "alert-circle-outline" : "flask-outline"} size={20} color={c.text} />
              </View>
              {/* Only the text opens the vial, so Reorder stays its own VoiceOver element. */}
              <Pressable
                style={({ pressed }) => [styles.fill, pressed ? { opacity: 0.6 } : null]}
                accessibilityRole="button"
                accessibilityLabel={`${name} vial: ${note.detail}`}
                accessibilityHint="Opens this vial"
                hitSlop={8}
                onPress={() => {
                  haptic("select");
                  onOpen(item);
                }}
              >
                <View style={styles.supplyName}>
                  {item.protocol ? <Dot color={item.protocol.color} size={8} /> : null}
                  <TText variant="bodyStrong" numberOfLines={1} style={styles.protoName}>{`${name} vial`}</TText>
                </View>
                <TText variant="meta" color={c.text} tabular numberOfLines={2}>
                  {note.detail}
                </TText>
              </Pressable>
              {productId ? (
                <PressButton label="Reorder" size="sm" tone="secondary" accessibilityHint={`Opens ${name} in the shop`} onPress={() => onReorder(productId)} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={th.inkFaint} />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function CheckInNudge({ onPress }: { onPress: () => void }) {
  const th = useTrackerTheme();
  return (
    <Card tone="brand" style={styles.row} onPress={onPress} accessibilityLabel="How are you feeling today? Check in" accessibilityHint="Log energy, side effects and weight">
      <View style={[styles.vialIcon, { backgroundColor: th.brandSoft }]}>
        <Ionicons name="happy-outline" size={22} color={th.brandText} />
      </View>
      <View style={styles.fill}>
        <TText variant="bodyStrong">How are you feeling today?</TText>
        <TText variant="meta" color="soft">
          Energy, side effects (or none), weight: 20 seconds.
        </TText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={th.brandText} />
    </Card>
  );
}

export function ProtocolStrip({ protocols, onOpen, onAdd }: { protocols: Protocol[]; onOpen: (id: string) => void; onAdd: () => void }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.strip}>
      <SectionHeader title="Your protocols" action={{ label: "Add", onPress: onAdd }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripRow}>
        {protocols.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}${p.status === "paused" ? ", paused" : ""}`}
            accessibilityHint="Open protocol details"
            onPress={() => {
              haptic("select");
              onOpen(p.id);
            }}
            style={({ pressed }) => [styles.protoChip, { backgroundColor: th.surface, borderColor: th.line }, pressed ? { opacity: 0.7 } : null]}
          >
            <Dot color={p.color} />
            <TText variant="meta" numberOfLines={1} style={styles.protoName}>
              {p.name}
            </TText>
            {p.status === "paused" ? <Ionicons name="pause" size={13} color={th.inkFaint} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

type SyncProps = {
  isOnline: boolean;
  pendingCount: number;
  hasSaveError: boolean;
  hasLoadError: boolean;
  /** Changes the server refused (cleared in Tracker settings). */
  rejectedCount?: number;
};

/** Nothing when all is well. Never alarming: the phone copy is the source of truth. */
export function SyncStatus({ isOnline, pendingCount, hasSaveError, hasLoadError, rejectedCount = 0 }: SyncProps) {
  const th = useTrackerTheme();
  let icon: "cloud-offline-outline" | "cloud-upload-outline" | "alert-circle-outline" | "information-circle-outline" | null = null;
  let text = "";
  if (hasSaveError) {
    icon = "alert-circle-outline";
    text = "This phone couldn’t save the last change. Free up some space and try again.";
  } else if (hasLoadError) {
    icon = "cloud-upload-outline";
    text = "Opening your tracker on this phone…";
  } else if (!isOnline) {
    icon = "cloud-offline-outline";
    text = pendingCount > 0 ? `Offline · ${plural(pendingCount, "change")} saved on this phone, will sync later` : "Offline · everything still works";
  } else if (pendingCount > 0) {
    icon = "cloud-upload-outline";
    text = `Syncing ${plural(pendingCount, "change")}…`;
  } else if (rejectedCount > 0) {
    icon = "information-circle-outline";
    text = `${plural(rejectedCount, "change")} couldn’t sync. Still saved on this phone. See Tracker settings.`;
  }
  if (!icon) return null;
  const color = hasSaveError ? th.status.low.text : th.inkFaint;
  return (
    <View style={styles.sync} accessibilityLiveRegion="polite" accessible accessibilityLabel={text}>
      <Ionicons name={icon} size={15} color={color} />
      <TText variant="meta" color={color} style={styles.fill}>
        {text}
      </TText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  supplyRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, paddingVertical: TSPACE.md },
  supplyIcon: { width: 40, height: 40, borderRadius: TRADIUS.md, alignItems: "center", justifyContent: "center" },
  vialIcon: { width: 44, height: 44, borderRadius: TRADIUS.md, alignItems: "center", justifyContent: "center" },
  supplyName: { flexDirection: "row", alignItems: "center", gap: 6 },
  strip: { gap: TSPACE.xs },
  stripRow: { gap: TSPACE.sm, paddingVertical: 2 },
  protoChip: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: TOUCH_MIN, paddingHorizontal: 14, borderRadius: TRADIUS.pill, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  protoName: { flexShrink: 1 },
  sync: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
});
