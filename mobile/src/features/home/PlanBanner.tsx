import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { subscriptionOf, trialOf, type BrandSubscription, type BrandTrial } from "@/features/admin/account/rules";
import { useAdminBrand } from "@/features/admin/setup/data";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * The website admin's plan chrome on Home — TrialBanner (active trial countdown
 * / "your trial has ended") and SubscriptionBanner (term countdown / "ended").
 * Both read the brand the server projects (brand.trial / brand.subscription,
 * so the countdown never trusts the phone's clock), through the same
 * trialOf / subscriptionOf the Upgrade and Billing screens use.
 *
 * Deliberately literal colours, like the website: this is platform chrome, the
 * same on every store, and must stay readable under any store palette.
 */

/** The progress fields brand.trial / brand.subscription also carry (lib/trial, lib/subscription). */
type Progress = { dayNum?: number; totalDays?: number; pctUsed?: number };

const CHROME = {
  trial: { bg: "#123B2A", fg: "#F4EFE3", muted: "#B9CDBF", accent: "#E4B54A", track: "rgba(255,255,255,0.18)" },
  trialEnded: { bg: "#5A1D14", fg: "#FBEDE9", muted: "#E9BDB3", accent: "#FBEDE9", track: "rgba(255,255,255,0.18)" },
  sub: { bg: "#1F2933", fg: "#F1F5F9", muted: "#B8C4D0", accent: "#60A5FA", track: "rgba(255,255,255,0.18)" },
  subEnded: { bg: "#5C3B06", fg: "#FFF7E6", muted: "#F1D7A6", accent: "#FFF7E6", track: "rgba(255,255,255,0.18)" },
} as const;
type Chrome = (typeof CHROME)[keyof typeof CHROME];

function endsLabel(iso: string, withYear: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

function Cta({ label, chrome, onPress }: { label: string; chrome: Chrome; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.cta, { borderColor: chrome.fg, opacity: pressed ? 0.7 : 1 }]}
    >
      <AppText variant="label" color={chrome.fg} style={{ fontWeight: "600" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function Bar({ chrome, pct, left, right }: { chrome: Chrome; pct: number | undefined; left: string; right: string }) {
  if (pct === undefined) return null;
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.track, { backgroundColor: chrome.track }]}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: chrome.accent }]} />
      </View>
      <View style={styles.scale}>
        <AppText variant="caption" color={chrome.muted}>{left}</AppText>
        <AppText variant="caption" color={chrome.muted}>{right}</AppText>
      </View>
    </View>
  );
}

function TrialBar({ trial }: { trial: BrandTrial & Progress }) {
  const upgrade = () => router.push("/manage/upgrade");
  if (trial.expired) {
    const c = CHROME.trialEnded;
    return (
      <View accessibilityRole="summary" style={[styles.band, { backgroundColor: c.bg }]}>
        <AppText variant="bodyStrong" color={c.fg}>Your trial has ended</AppText>
        <AppText variant="caption" color={c.muted}>
          Your storefront is paused. Customers currently see a “We’re currently on pause” page.
        </AppText>
        <View style={styles.actions}>
          <Cta label="Preview it" chrome={c} onPress={() => router.push("/storefront")} />
          <Cta label="Unlock with Business" chrome={c} onPress={upgrade} />
        </View>
      </View>
    );
  }
  const c = CHROME.trial;
  const total = trial.totalDays;
  return (
    <View accessibilityRole="summary" style={[styles.band, { backgroundColor: c.bg }]}>
      <AppText variant="bodyStrong" color={c.fg}>
        {`${total ? `${total}-Day Trial · ` : "Trial · "}${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left`}
      </AppText>
      <Bar
        chrome={c}
        pct={trial.pctUsed}
        left={trial.dayNum && total ? `Day ${trial.dayNum} of ${total}` : ""}
        right={`Ends ${endsLabel(trial.endsAt, false)}`}
      />
      <AppText variant="caption" color={c.muted}>Your trial payment is credited when you upgrade</AppText>
      <View style={styles.actions}>
        <Cta label="Upgrade to Business" chrome={c} onPress={upgrade} />
      </View>
    </View>
  );
}

function SubscriptionBar({ sub }: { sub: BrandSubscription & Progress }) {
  const billing = () => router.push("/manage/billing");
  if (sub.expired) {
    const c = CHROME.subEnded;
    return (
      <View accessibilityRole="summary" style={[styles.band, { backgroundColor: c.bg }]}>
        <AppText variant="bodyStrong" color={c.fg}>Subscription ended</AppText>
        <AppText variant="caption" color={c.muted}>
          {`Your subscription period ended on ${endsLabel(sub.endsAt, true)}. Submit your renewal payment on the Billing page or contact your provider.`}
        </AppText>
        <View style={styles.actions}>
          <Cta label="View billing" chrome={c} onPress={billing} />
        </View>
      </View>
    );
  }
  const c = CHROME.sub;
  return (
    <View accessibilityRole="summary" style={[styles.band, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" color={c.fg} style={{ flex: 1 }}>
          {`Subscription · ${sub.daysLeft} ${sub.daysLeft === 1 ? "day" : "days"} left`}
        </AppText>
        <Cta label="View billing" chrome={c} onPress={billing} />
      </View>
      <Bar
        chrome={c}
        pct={sub.pctUsed}
        left={sub.dayNum && sub.totalDays ? `Day ${sub.dayNum} of ${sub.totalDays}` : ""}
        right={`Renews ${endsLabel(sub.endsAt, true)}`}
      />
    </View>
  );
}

/** Nothing when the store is neither trial- nor subscription-governed (or the brand can't load). */
export function PlanBanner() {
  const brand = useAdminBrand();
  if (!brand.data) return null;
  const trial = trialOf(brand.data) as (BrandTrial & Progress) | null;
  const sub = subscriptionOf(brand.data) as (BrandSubscription & Progress) | null;
  if (!trial && !sub) return null;
  return (
    <View style={{ gap: SPACE.md }}>
      {trial ? <TrialBar trial={trial} /> : null}
      {sub ? <SubscriptionBar sub={sub} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.sm },
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginTop: 2 },
  cta: { minHeight: 36, paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  scale: { flexDirection: "row", justifyContent: "space-between" },
});
