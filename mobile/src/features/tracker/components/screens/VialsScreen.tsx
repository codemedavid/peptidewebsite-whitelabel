/**
 * VIALS (TRACKER.md §3–4): "Add from my orders" on top (one tap → unopened
 * vials on the shelf), then In use / Unopened / Finished & expired. Each card
 * shows the drawn gauge, what's left, doses left, run-out day and the expiry
 * countdown; tap to edit. Everything is worked out from logged doses
 * (lib/vials vialStatus) — nothing here is stored.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TrackerOrderVial } from "@contract";
import { sizedImage } from "@/features/shop/lib/catalog";
import { deleteVial, saveVial, useNow, useOrderVials, useProtocols, useVials, type VialView } from "../../hooks";
import { unitLabel } from "../../lib/dose-math";
import { notify } from "../dialog";
import { plural } from "../format";
import { Card, DisclaimerFooter, EmptyState, haptic, IconButton, Pill, PressButton, SectionHeader, TText } from "../kit";
import { trackerHref } from "../routes";
import { TRADIUS, TSPACE, useTrackerTheme, type TrackerTheme } from "../theme";
import { showTrackerToast, UndoToast } from "../toast";
import { expiryText, lineDetail, protocolForLine, vialLeftText, vialPhase, vialSections, vialsFromLine, type VialNote } from "../vial-model";
import { VialGauge } from "../VialGauge";

const THUMB = 52;

function back(): void {
  if (router.canGoBack()) router.back();
  else router.replace(trackerHref.home());
}

export function VialsScreen() {
  const th = useTrackerTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { isLoaded, vials } = useVials(now);
  const { protocols } = useProtocols();
  const orders = useOrderVials();
  const sections = vialSections(vials);

  const addFromOrder = (line: TrackerOrderVial) => {
    const protocol = protocolForLine(line, protocols);
    const drafts = protocol ? vialsFromLine(line, protocol.id) : [];
    // No matching protocol, or no strength on the line: the form asks for what's missing.
    if (!protocol || drafts.length === 0) {
      router.push(trackerHref.vial({ orderKey: line.key }));
      return;
    }
    try {
      const saved = drafts.flatMap((d) => (d ? [saveVial(d)] : []));
      haptic("success");
      showTrackerToast({
        message: `${saved.length > 1 ? plural(saved.length, "vial") : "Vial"} added to ${protocol.name} · unopened`,
        icon: "flask",
        undo: () => saved.forEach((v) => deleteVial(v.id)),
      });
    } catch {
      notify("Couldn’t add the vial", "This phone couldn’t save it. Free up some space and try again.");
    }
  };

  const hasNothing = isLoaded && vials.length === 0 && orders.lines.length === 0;

  return (
    <View style={[styles.screen, { backgroundColor: th.bg }]}>
      <View style={[styles.bar, { paddingTop: insets.top + TSPACE.xs }]}>
        <IconButton icon="chevron-back" label="Back" onPress={back} />
        <TText variant="title" accessibilityRole="header" style={styles.fill} numberOfLines={1}>
          Vials
        </TText>
        <PressButton label="Add" icon="add" tone="soft" size="sm" accessibilityLabel="Add a vial" onPress={() => router.push(trackerHref.vial())} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TSPACE.xxxl }]}>
        {orders.lines.length > 0 ? (
          <View style={styles.block}>
            <SectionHeader title="Add from my orders" />
            <Card style={styles.orderCard}>
              {orders.lines.map((line, i) => (
                <OrderLine key={line.key} line={line} isFirst={i === 0} onAdd={() => addFromOrder(line)} />
              ))}
            </Card>
          </View>
        ) : null}

        {!isLoaded ? <View style={[styles.skeleton, { backgroundColor: th.surfaceAlt }]} accessible accessibilityRole="progressbar" accessibilityLabel="Loading your vials" /> : null}

        {hasNothing ? (
          <EmptyState
            icon="flask-outline"
            title="No vials yet"
            body="Add a vial to see what’s left, how many doses remain and when it runs out. It counts down as you log."
            action={{ label: "Add a vial", icon: "add", onPress: () => router.push(trackerHref.vial()) }}
          />
        ) : null}

        {sections.map((section) => (
          <View key={section.phase} style={styles.block}>
            <SectionHeader title={`${section.title} · ${section.items.length}`} />
            {section.items.map((item) => (
              <VialCard key={item.vial.id} item={item} now={now} />
            ))}
          </View>
        ))}

        <DisclaimerFooter />
      </ScrollView>
      <UndoToast bottom={insets.bottom + TSPACE.lg} />
    </View>
  );
}

// ── Order line ───────────────────────────────────────────────────────────

function OrderLine({ line, isFirst, onAdd }: { line: TrackerOrderVial; isFirst: boolean; onAdd: () => void }) {
  const th = useTrackerTheme();
  const detail = lineDetail(line);
  const src = sizedImage(line.imageUrl, THUMB * 3) ?? line.imageUrl;
  const count = Math.max(1, line.quantity);
  return (
    <View style={[styles.orderRow, isFirst ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.line }]}>
      {src ? (
        <Image source={{ uri: src }} style={[styles.thumb, { backgroundColor: th.surfaceAlt }]} contentFit="cover" accessibilityIgnoresInvertColors accessible={false} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: th.brandSoft }]}>
          <Ionicons name="cube-outline" size={22} color={th.brandText} />
        </View>
      )}
      <View style={styles.fill} accessible accessibilityLabel={`${line.name}, ${detail}`}>
        <TText variant="bodyStrong" numberOfLines={2}>
          {line.name}
        </TText>
        <TText variant="meta" color="soft" numberOfLines={2}>
          {detail}
        </TText>
      </View>
      <PressButton
        label={count > 1 ? `Add ${count}` : "Add vial"}
        icon="add"
        size="sm"
        tone="primary"
        hapticKind="none"
        accessibilityLabel={`Add ${plural(count, "vial")} from ${line.name}`}
        accessibilityHint="Saved as unopened"
        onPress={onAdd}
      />
    </View>
  );
}

// ── Vial card ────────────────────────────────────────────────────────────

/** The liquid colour and word for a vial's state (every state also has a word — never colour alone). */
function lookOf(item: VialView, th: TrackerTheme): { color: string; pill: { label: string; status?: "low" | "missed" | "done"; icon: "alert-circle" | "warning" | "lock-closed" | "checkmark" } | null } {
  const phase = vialPhase(item.vial);
  if (phase === "done") return { color: th.inkFaint, pill: { label: "Finished", icon: "checkmark" } };
  if (item.isExpired) return { color: th.status.missed.solid, pill: { label: "Expired", status: "missed", icon: "alert-circle" } };
  if (phase === "sealed") return { color: th.brand, pill: { label: "Unopened", icon: "lock-closed" } };
  if (item.dosesLeft === 0 || item.pct <= 0) return { color: th.status.missed.solid, pill: { label: "Empty", status: "missed", icon: "alert-circle" } };
  if (item.isLow) return { color: th.status.low.solid, pill: { label: "Low", status: "low", icon: "warning" } };
  return { color: th.brand, pill: null };
}

function VialCard({ item, now }: { item: VialView; now: Date }) {
  const th = useTrackerTheme();
  const { vial } = item;
  const phase = vialPhase(vial);
  const look = lookOf(item, th);
  const name = item.protocol?.name ?? "Vial";
  const strength = `${vial.amount} ${unitLabel(vial.unit)}${vial.waterMl ? ` + ${vial.waterMl} mL water` : ""}`;
  const left =
    phase === "sealed"
      ? "Full · not opened yet"
      : phase === "done"
        ? vialLeftText({ ...item, runOutDate: null }, now)
        : vialLeftText(item, now);
  const expiry = phase === "done" ? null : expiryText(item.expiresOn, now);
  const expiryColor = expiry?.tone === "expired" ? th.status.missed.text : expiry?.tone === "soon" ? th.status.low.text : th.inkSoft;
  const note = (vial as VialNote).note;
  const spoken = [`${name} vial`, look.pill?.label, strength, left, expiry?.text, vial.lot ? `lot ${vial.lot}` : null].filter(Boolean).join(". ");

  return (
    <Card onPress={() => router.push(trackerHref.vial({ id: vial.id }))} accessibilityLabel={spoken} accessibilityHint="Edit this vial" style={styles.vialCard}>
      <VialGauge pct={phase === "sealed" ? 100 : item.pct} color={look.color} isSealed={phase === "sealed"} />
      <View style={styles.fill}>
        <View style={styles.titleRow}>
          <TText variant="headline" numberOfLines={2} style={styles.shrink}>
            {name}
          </TText>
          {look.pill ? <Pill label={look.pill.label} status={look.pill.status} icon={look.pill.icon} /> : null}
        </View>
        <TText variant="meta" color="soft" tabular numberOfLines={2}>
          {strength}
        </TText>
        {/* "Empty" is already the badge — don't say it twice. */}
        {look.pill?.label === "Empty" ? null : (
          <TText variant="bodyStrong" tabular color={item.isLow && phase === "inUse" ? th.status.low.text : "ink"}>
            {left}
          </TText>
        )}
        {expiry ? (
          <View style={styles.expiry}>
            <Ionicons name="time-outline" size={14} color={expiryColor} />
            <TText variant="meta" color={expiryColor} tabular style={styles.shrink}>
              {expiry.text}
            </TText>
          </View>
        ) : null}
        {note ? (
          <TText variant="meta" color="faint" numberOfLines={2}>
            {note}
          </TText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={th.inkFaint} />
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1, gap: 2 },
  shrink: { flexShrink: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, paddingHorizontal: TSPACE.gutter, paddingBottom: TSPACE.xs },
  content: { paddingHorizontal: TSPACE.gutter, paddingTop: TSPACE.sm, gap: TSPACE.section },
  block: { gap: TSPACE.sm },
  orderCard: { paddingVertical: TSPACE.xs, gap: 0 },
  orderRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, paddingVertical: TSPACE.md },
  thumb: { width: THUMB, height: THUMB, borderRadius: TRADIUS.sm },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  vialCard: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: TSPACE.sm },
  expiry: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  skeleton: { height: 120, borderRadius: TRADIUS.lg },
});
