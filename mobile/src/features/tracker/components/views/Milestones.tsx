/**
 * MILESTONES (lib/consistency `milestones`, rare on purpose): earned badges,
 * newest first, in a horizontal row. A badge earned this week wears "New".
 * Nothing earned yet → three locked, greyed badges show what's ahead.
 * Celebratory but quiet: no confetti, no motion beyond the kit's.
 */
import { ScrollView, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Milestone } from "../../lib/consistency";
import { daysBetween, formatDay } from "../../lib/ids";
import { Pill, SectionHeader, TText, type IconName } from "../kit";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";

const NEW_DAYS = 7;
const BADGE_W = 136;

function iconFor(key: string): IconName {
  if (key === "first-dose") return "sparkles";
  if (key === "full-week") return "calendar";
  if (key.startsWith("doses-")) return "medal";
  if (key.startsWith("run-")) return "flame";
  if (key === "first-vial") return "flask";
  if (key === "cycle") return "sync";
  return "ribbon";
}

const LOCKED: readonly { key: string; title: string }[] = [
  { key: "first-dose", title: "First dose logged" },
  { key: "full-week", title: "First full week on schedule" },
  { key: "doses-25", title: "25 doses logged" },
];

export function Milestones({ earned, today }: { earned: readonly Milestone[]; today: string }) {
  const newest = [...earned].reverse();
  return (
    <View style={styles.wrap}>
      <SectionHeader
        title="Milestones"
        right={
          earned.length > 0 ? (
            <TText variant="meta" color="faint" tabular>
              {`${earned.length} earned`}
            </TText>
          ) : undefined
        }
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {newest.length > 0
          ? newest.map((m) => <Badge key={m.key} title={m.title} sub={formatDay(m.day)} icon={iconFor(m.key)} isNew={daysBetween(m.day, today) < NEW_DAYS} />)
          : LOCKED.map((m) => <Badge key={m.key} title={m.title} sub="Ahead of you" icon={iconFor(m.key)} isLocked />)}
      </ScrollView>
    </View>
  );
}

function Badge({ title, sub, icon, isNew, isLocked }: { title: string; sub: string; icon: IconName; isNew?: boolean; isLocked?: boolean }) {
  const th = useTrackerTheme();
  const spoken = isLocked ? `Not earned yet: ${title}` : `Milestone: ${title}, ${sub}${isNew ? ", new" : ""}`;
  return (
    <View
      style={[styles.badge, { backgroundColor: isLocked ? th.surfaceAlt : th.surface, borderColor: isNew ? th.brand : th.line }, isLocked ? null : th.shadow.card]}
      accessible
      accessibilityLabel={spoken}
    >
      <View style={styles.badgeTop}>
        <View style={[styles.medal, { backgroundColor: isLocked ? th.line : th.brand, borderColor: isLocked ? th.surfaceAlt : th.brandSoft }]}>
          <Ionicons name={isLocked ? "lock-closed" : icon} size={20} color={isLocked ? th.inkFaint : th.onBrand} />
        </View>
        {isNew ? <Pill label="New" tone="brand" /> : null}
      </View>
      <TText variant="bodyStrong" color={isLocked ? "soft" : "ink"} numberOfLines={3}>
        {title}
      </TText>
      <TText variant="meta" color="faint" tabular>
        {sub}
      </TText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.md },
  row: { gap: TSPACE.sm, paddingRight: TSPACE.sm, paddingBottom: TSPACE.xs },
  badge: { width: BADGE_W, borderRadius: TRADIUS.lg, borderWidth: 1, padding: TSPACE.md, gap: TSPACE.xs },
  badgeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: TSPACE.xs },
  medal: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 3 },
});
