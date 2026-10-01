import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Segmented } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";
import type { CardDesign } from "./model";
import { PreviewCard, type CardTheme, type SampleProduct } from "./PreviewCard";

/**
 * The website Card Studio's gallery pieces: design tiles (tap to apply), the
 * full-size preview sheet with device frames, and the side-by-side compare.
 */

export type Device = "desktop" | "tablet" | "mobile";

export const DEVICES: { key: Device; label: string }[] = [
  { key: "desktop", label: "Desktop" },
  { key: "tablet", label: "Tablet" },
  { key: "mobile", label: "Mobile" },
];

/** The column width the catalog grid hands a card at each breakpoint (AdminCardStudio.frameWidth). */
export function frameWidth(device: Device, layout: CardDesign["layout"]): number {
  if (layout === "horizontal") return device === "desktop" ? 560 : device === "tablet" ? 390 : 178;
  return device === "desktop" ? 320 : device === "tablet" ? 252 : 178;
}

export type Entry = { key: string; name: string; tagline: string; design: CardDesign };

const GRID_GAP = SPACE.md;
const PAGE_PAD = SPACE.lg;

/** Touch-and-hold plays the design's hover effect (phones have no hover). */
export function HoldToHover({ children }: { children: (hovered: boolean) => ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityHint="Touch and hold to play the card's hover effect"
      onPressIn={() => setHovered(true)}
      onPressOut={() => setHovered(false)}
      style={styles.stage}
    >
      {children(hovered)}
    </Pressable>
  );
}

export function Tile({
  entry,
  theme,
  sample,
  active,
  customized,
  inCompare,
  onApply,
  onPreview,
  onCompare,
  onDelete,
}: {
  entry: Entry;
  theme: CardTheme;
  sample: SampleProduct;
  active: boolean;
  customized: boolean;
  inCompare: boolean;
  onApply: () => void;
  onPreview: () => void;
  onCompare: () => void;
  onDelete?: () => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const wide = entry.design.layout === "horizontal";
  const tileWidth = wide ? width - PAGE_PAD * 2 : (width - PAGE_PAD * 2 - GRID_GAP) / 2;
  return (
    <View
      style={[
        styles.tile,
        {
          width: tileWidth,
          borderColor: active ? t.brand.primary : t.colors.border,
          borderWidth: active ? 2 : 1,
          backgroundColor: t.colors.surface,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Apply the ${entry.name} design`}
        accessibilityState={{ selected: active }}
        onPress={onApply}
        style={({ pressed }) => [styles.tileStage, { backgroundColor: t.colors.surfaceAlt }, pressed ? { opacity: 0.8 } : null]}
      >
        <View pointerEvents="none" style={{ width: "100%" }}>
          <PreviewCard design={entry.design} theme={theme} sample={sample} collapse={!wide} />
        </View>
      </Pressable>
      <View style={styles.tileMeta}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="label" numberOfLines={1}>
            {entry.name}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={1}>
            {entry.tagline}
          </AppText>
        </View>
        {active ? <Ionicons name="checkmark-circle" size={20} color={t.tone("success").fg} accessibilityLabel="Currently applied" /> : null}
      </View>
      {active && customized ? (
        <View style={{ paddingHorizontal: SPACE.sm }}>
          <Pill tone="info" size="sm" label="Customized" />
        </View>
      ) : null}
      <View style={[styles.tileActions, { borderColor: t.colors.border }]}>
        <TileAction icon="expand-outline" label="Preview" a11y={`Full-size preview of ${entry.name}`} onPress={onPreview} />
        <TileAction
          icon={inCompare ? "checkbox" : "square-outline"}
          label={inCompare ? "Added" : "Compare"}
          a11y={inCompare ? `Remove ${entry.name} from compare` : `Add ${entry.name} to compare`}
          onPress={onCompare}
        />
        {onDelete && !active ? (
          <TileAction icon="trash-outline" label="" a11y={`Delete the template ${entry.name}`} onPress={onDelete} danger />
        ) : null}
      </View>
    </View>
  );
}

function TileAction({
  icon,
  label,
  a11y,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  a11y: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  const color = danger ? t.tone("danger").fg : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.tileAction, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name={icon} size={16} color={color} />
      {label ? (
        <AppText variant="caption" color={color}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export function GalleryGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** A page sheet with a title bar + Close, shared by preview and compare. */
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        <View style={[styles.sheetBar, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}>
          <AppText variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <AppText variant="bodyStrong" color="link">
              Close
            </AppText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + SPACE.xl }]}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function PreviewSheet({
  entry,
  theme,
  sample,
  device,
  onDevice,
  onApply,
  onClose,
}: {
  entry: { name: string; design: CardDesign } | null;
  theme: CardTheme;
  sample: SampleProduct;
  device: Device;
  onDevice: (d: Device) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={!!entry} title={entry ? `${entry.name} preview` : ""} onClose={onClose}>
      {entry ? (
        <>
          <Segmented segments={DEVICES} value={device} onChange={onDevice} />
          <HoldToHover>
            {(hovered) => (
              <PreviewCard
                design={entry.design}
                theme={theme}
                sample={sample}
                width={frameWidth(device, entry.design.layout)}
                collapse={device === "mobile"}
                hovered={hovered}
              />
            )}
          </HoldToHover>
          <Button label="Apply this design" icon="color-wand-outline" onPress={onApply} />
        </>
      ) : null}
    </Sheet>
  );
}

export function CompareSheet({
  visible,
  entries,
  theme,
  sample,
  device,
  onDevice,
  onApply,
  onClose,
}: {
  visible: boolean;
  entries: { key: string; name: string; design: CardDesign }[];
  theme: CardTheme;
  sample: SampleProduct;
  device: Device;
  onDevice: (d: Device) => void;
  onApply: (entry: { key: string; name: string; design: CardDesign }) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Sheet visible={visible} title="Compare designs" onClose={onClose}>
      <Segmented segments={DEVICES} value={device} onChange={onDevice} />
      <ScrollView horizontal contentContainerStyle={styles.compareRow} showsHorizontalScrollIndicator>
        {entries.map((c) => (
          <View key={c.key} style={[styles.compareCell, { borderColor: t.colors.border, width: frameWidth(device, c.design.layout) + SPACE.lg * 2 }]}>
            <AppText variant="label" numberOfLines={1}>
              {c.name}
            </AppText>
            <PreviewCard
              design={c.design}
              theme={theme}
              sample={sample}
              width={frameWidth(device, c.design.layout)}
              collapse={device === "mobile"}
            />
            <Button label="Apply" variant="secondary" onPress={() => onApply(c)} />
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", paddingVertical: SPACE.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile: { borderRadius: RADIUS.lg, overflow: "hidden" },
  tileStage: { padding: SPACE.sm, alignItems: "center" },
  tileMeta: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.sm, paddingTop: SPACE.sm },
  tileActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.sm,
    paddingVertical: SPACE.sm,
    marginTop: SPACE.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tileAction: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: { padding: SPACE.lg, gap: SPACE.lg },
  compareRow: { gap: SPACE.md, paddingVertical: SPACE.sm },
  compareCell: { gap: SPACE.md, padding: SPACE.lg, borderWidth: 1, borderRadius: RADIUS.lg, alignItems: "center" },
});
