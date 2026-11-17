/**
 * Today with no protocols (TRACKER.md §1 "sample chart on the empty first-run
 * screen"): a greyed, clearly-labelled SAMPLE week and countdown — no real
 * compound or dose in it, the app never suggests one — then three ways in:
 *   From my orders      delivered lines → a vial + setup prefilled from the product
 *   From <store>'s guide only with guide import; an editable draft to check
 *   Start from scratch  the setup wizard, empty
 */
import { useState } from "react";
import { Image } from "expo-image";
import { useReducedMotion } from "react-native-reanimated";
import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TrackerOrderVial, TrackerStoreGuide } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useOrderVials, useStoreGuides, useTrackerAccess } from "../hooks";
import type { DayInfo, DayState } from "../lib/consistency";
import { addDays, dayKey, weekStart } from "../lib/ids";
import { plural } from "./format";
import { Card, haptic, Pill, TText, type IconName } from "./kit";
import { trackerHref } from "./routes";
import { BottomSheet, SHEET_DISMISS_IS_ASYNC } from "./sheets";
import { TRADIUS, TSPACE, TOUCH_MIN, useTrackerTheme } from "./theme";
import { WeekDots } from "./WeekDots";

const SAMPLE_WEEK: DayState[] = ["kept", "kept", "partial", "kept", "missed", "kept", "planned"];
const SAMPLE_TODAY = 5;

function sampleWeek(now: Date): { days: DayInfo[]; today: string } {
  const start = weekStart(dayKey(now));
  const days = SAMPLE_WEEK.map((state, i) => ({ day: addDays(start, i), state, slots: [], extras: [] }));
  return { days, today: days[SAMPLE_TODAY].day };
}

type Sheet = "orders" | "guides" | null;

export function EmptyToday({ now }: { now: Date }) {
  const th = useTrackerTheme();
  const { me } = useSignedIn();
  const access = useTrackerAccess();
  const orders = useOrderVials();
  const guides = useStoreGuides();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [next, setNext] = useState<Href | null>(null);
  const sample = sampleWeek(now);
  const store = me.store.name;
  const guideList = guides.data ?? [];

  // Close the sheet, then navigate once it's gone (iOS drops a push mid-dismiss).
  const go = (href: Href) => {
    setSheet(null);
    if (SHEET_DISMISS_IS_ASYNC) setNext(href);
    else router.push(href);
  };
  const onDismissed = () => {
    if (!next) return;
    const href = next;
    setNext(null);
    router.push(href);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.sample} accessible accessibilityLabel="Sample of a filled-in tracker. Not your data.">
        <View style={styles.sampleTag}>
          <Pill label="Sample" icon="eye-outline" />
        </View>
        <Card style={styles.dim}>
          <WeekDots days={sample.days} today={sample.today} isSample />
        </Card>
        <View style={[styles.sampleHero, styles.dim, { backgroundColor: th.brand }]}>
          <TText variant="micro" color="onBrandSoft">
            Next dose in
          </TText>
          <TText variant="hero" color="onBrand" tabular>
            3h 12m
          </TText>
          <TText variant="bodyStrong" color="onBrand">
            Your protocol · your dose · 8:00 PM
          </TText>
          <View style={[styles.fakeButton, { backgroundColor: th.onBrand }]}>
            <Ionicons name="checkmark-circle" size={20} color={th.brand} />
            <TText variant="headline" color={th.brand}>
              Log dose
            </TText>
          </View>
        </View>
      </View>

      <View style={styles.copy}>
        <TText variant="display" accessibilityRole="header">
          Every dose, one tap.
        </TText>
        <TText variant="body" color="soft">
          Add what you’re taking once. Then log with one tap, rotate injection sites, and see your vial run down. Reminders included.
        </TText>
      </View>

      <View style={styles.options}>
        {orders.lines.length > 0 ? (
          <StartOption
            icon="cube-outline"
            title="From my orders"
            body={`${plural(orders.lines.length, "delivered item")} ready to add as a vial`}
            onPress={() => setSheet("orders")}
          />
        ) : null}
        {access.guideImport && guideList.length > 0 ? (
          <StartOption icon="book-outline" title={`From ${store}’s guide`} body="Copy a guide into a draft you check and edit" onPress={() => setSheet("guides")} />
        ) : null}
        <StartOption icon="add-circle-outline" title="Start from scratch" body="Name, dose, schedule: about a minute" isPrimary onPress={() => router.push(trackerHref.protocolEdit())} />
      </View>

      <BottomSheet visible={sheet === "orders"} onClose={() => setSheet(null)} onDismissed={onDismissed} title="From my orders" subtitle="Pick what you received. You’ll set the dose and schedule next.">
        {orders.lines.map((line) => (
          <OrderLineRow key={line.key} line={line} onPress={() => go(trackerHref.protocolEdit({ orderKey: line.key }))} />
        ))}
      </BottomSheet>
      <BottomSheet visible={sheet === "guides"} onClose={() => setSheet(null)} onDismissed={onDismissed} title={`${store}’s guides`} subtitle="Copied into an editable draft. Check every number before saving.">
        {guideList.map((g) => (
          <GuideRow key={g.name} guide={g} onPress={() => go(trackerHref.protocolEdit({ guide: g.name }))} />
        ))}
      </BottomSheet>
    </View>
  );
}

function StartOption({ icon, title, body, onPress, isPrimary }: { icon: IconName; title: string; body: string; onPress: () => void; isPrimary?: boolean }) {
  const th = useTrackerTheme();
  const reduceMotion = useReducedMotion();
  const fg = isPrimary ? th.onBrand : th.brandText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      onPress={() => {
        haptic("tap");
        onPress();
      }}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: isPrimary ? th.brand : th.surface, borderColor: isPrimary ? th.brand : th.line },
        isPrimary ? th.shadow.card : null,
        pressed && !reduceMotion ? { transform: [{ scale: 0.98 }] } : null,
      ]}
    >
      <View style={[styles.optionIcon, { backgroundColor: isPrimary ? th.onBrandLine : th.brandSoft }]}>
        <Ionicons name={icon} size={22} color={fg} />
      </View>
      <View style={styles.fill}>
        <TText variant="headline" color={isPrimary ? "onBrand" : "ink"}>
          {title}
        </TText>
        <TText variant="meta" color={isPrimary ? "onBrandSoft" : "soft"}>
          {body}
        </TText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={fg} />
    </Pressable>
  );
}

function OrderLineRow({ line, onPress }: { line: TrackerOrderVial; onPress: () => void }) {
  const th = useTrackerTheme();
  const what = [line.variation, line.quantity > 1 ? `× ${line.quantity}` : null].filter(Boolean).join(" ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line.name}${what ? `, ${what}` : ""}, order ${line.orderNumber}`}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [styles.lineRow, { borderColor: th.line, backgroundColor: pressed ? th.surfaceAlt : th.surface }]}
    >
      {line.imageUrl ? (
        <Image source={{ uri: line.imageUrl }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: th.brandSoft }]}>
          <Ionicons name="flask-outline" size={20} color={th.brandText} />
        </View>
      )}
      <View style={styles.fill}>
        <TText variant="bodyStrong" numberOfLines={2}>
          {line.name}
        </TText>
        <TText variant="meta" color="soft" numberOfLines={1}>
          {[what, `Order ${line.orderNumber}`].filter(Boolean).join(" · ")}
        </TText>
      </View>
      <Ionicons name="add-circle-outline" size={22} color={th.brandText} />
    </Pressable>
  );
}

function GuideRow({ guide, onPress }: { guide: TrackerStoreGuide; onPress: () => void }) {
  const th = useTrackerTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${guide.name}${guide.category ? `, ${guide.category}` : ""}`}
      accessibilityHint="Copies it into a draft you can edit"
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [styles.lineRow, { borderColor: th.line, backgroundColor: pressed ? th.surfaceAlt : th.surface }]}
    >
      <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: th.brandSoft }]}>
        <Ionicons name="book-outline" size={20} color={th.brandText} />
      </View>
      <View style={styles.fill}>
        <TText variant="bodyStrong" numberOfLines={2}>
          {guide.name}
        </TText>
        {guide.category ? (
          <TText variant="meta" color="soft" numberOfLines={1}>
            {guide.category}
          </TText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={th.inkFaint} />
    </Pressable>
  );
}

const THUMB = 48;

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.xl },
  fill: { flex: 1 },
  sample: { gap: TSPACE.sm },
  sampleTag: { flexDirection: "row" },
  dim: { opacity: 0.5 },
  sampleHero: { borderRadius: TRADIUS.xl, padding: TSPACE.xl - 4, gap: 4 },
  fakeButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: TSPACE.sm, minHeight: 52, borderRadius: TRADIUS.md, marginTop: TSPACE.sm },
  copy: { gap: TSPACE.sm },
  options: { gap: TSPACE.md },
  option: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: 72, padding: TSPACE.lg, borderRadius: TRADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  optionIcon: { width: 44, height: 44, borderRadius: TRADIUS.md, alignItems: "center", justifyContent: "center" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.md, minHeight: TOUCH_MIN + 20, padding: TSPACE.md, borderRadius: TRADIUS.md, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: THUMB, height: THUMB, borderRadius: TRADIUS.sm },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
});
