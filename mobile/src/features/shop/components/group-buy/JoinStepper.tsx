import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { GroupBuyStepper } from "@shop-contract";
import type { Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, type IconName } from "@/ui/primitives";

/**
 * The member's progress, exactly as the server words it (Paid Access
 * core/view.ts stepperView): the step dots, then "Step 2 of 3: …" and what
 * happens next. Nothing here re-derives a rule.
 */

export const STEPPER_TONE: Record<GroupBuyStepper["tone"], Tone> = { neutral: "neutral", pending: "warning", success: "success", danger: "danger" };

const TONE_ICON: Record<GroupBuyStepper["tone"], IconName> = {
  neutral: "people-outline",
  pending: "time-outline",
  success: "checkmark-circle-outline",
  danger: "close-circle-outline",
};

type Props = { stepper: GroupBuyStepper; canAccess: boolean };

export function JoinStepper({ stepper, canAccess }: Props) {
  const t = useTheme();
  const c = t.tone(STEPPER_TONE[stepper.tone]);
  // The server's steps, then the goal they lead to.
  const dots = stepper.steps.length
    ? [...stepper.steps.map((s) => ({ key: s.key as string, label: s.label, state: s.state })), { key: "access", label: stepper.accessLabel ?? "Access", state: canAccess ? ("done" as const) : ("upcoming" as const) }]
    : [];
  const a11y = stepper.position ? `Step ${stepper.position} of ${stepper.total}` : stepper.headline;

  return (
    <View style={{ gap: SPACE.md }}>
      {dots.length ? (
        <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={a11y}>
          {dots.map((d, i) => {
            const done = d.state === "done";
            const now = d.state === "current";
            return (
              <View key={d.key} style={styles.step}>
                <View style={styles.track}>
                  {i > 0 ? <View style={[styles.line, { backgroundColor: done || now ? t.brand.primary : t.colors.border }]} /> : <View style={styles.lineGap} />}
                  <View
                    style={[
                      styles.dot,
                      {
                        borderColor: done || now ? t.brand.primary : t.colors.border,
                        backgroundColor: done ? t.brand.primary : t.colors.surface,
                        borderWidth: now ? 2.5 : 1.5,
                      },
                    ]}
                  >
                    {done ? (
                      <Ionicons name="checkmark" size={14} color={t.brand.onPrimary} />
                    ) : (
                      <AppText variant="caption" color={now ? "link" : "muted"}>
                        {String(i + 1)}
                      </AppText>
                    )}
                  </View>
                  {i < dots.length - 1 ? (
                    <View style={[styles.line, { backgroundColor: done ? t.brand.primary : t.colors.border }]} />
                  ) : (
                    <View style={styles.lineGap} />
                  )}
                </View>
                <AppText variant="caption" color={now ? "text" : "muted"} style={styles.stepLabel} numberOfLines={2}>
                  {d.label}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}

      <View accessibilityLiveRegion="polite" style={[styles.status, { backgroundColor: c.bg }]}>
        <Ionicons name={TONE_ICON[stepper.tone]} size={20} color={c.fg} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" color={c.fg}>
            {stepper.headline}
          </AppText>
          {stepper.detail ? (
            <AppText variant="caption" color={c.fg}>
              {stepper.detail}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const DOT = 28;

const styles = StyleSheet.create({
  steps: { flexDirection: "row" },
  step: { flex: 1, alignItems: "center", gap: SPACE.xs, minWidth: 0 },
  track: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  line: { flex: 1, height: 2 },
  lineGap: { flex: 1 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: "center", justifyContent: "center" },
  stepLabel: { textAlign: "center", paddingHorizontal: 2 },
  status: { flexDirection: "row", gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.lg },
});
