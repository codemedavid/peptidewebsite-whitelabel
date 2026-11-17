/**
 * Steps 4 and 5 — Reminders, then Review. Review shows the protocol the form
 * would save, section by section, each with an "Edit" jump back to its step.
 */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatDose, unitLabel } from "../../lib/dose-math";
import { formatDay } from "../../lib/ids";
import { formToProtocol, type ProtocolForm } from "../../lib/protocol-form";
import { describeSchedule } from "../../lib/schedule";
import { ToggleRow } from "../fields";
import { BellIllustration } from "../Illustration";
import { Card, Dot, PressButton, TText } from "../kit";
import { TRADIUS, TSPACE, useTrackerTheme } from "../theme";

export type SetupStep = "compound" | "dose" | "schedule" | "reminders" | "review";

export function RemindersStep({ form, onChange }: { form: ProtocolForm; onChange: (patch: Partial<ProtocolForm>) => void }) {
  const isAsNeeded = form.scheduleKind === "asNeeded";
  return (
    <View style={styles.wrap}>
      <View style={styles.center}>
        <BellIllustration size={120} />
      </View>
      <ToggleRow
        label="Remind me at each dose time"
        hint={isAsNeeded ? "As-needed protocols have no dose times to remind you about." : "A notification on this phone with Taken and Snooze buttons."}
        value={form.reminders && !isAsNeeded}
        isDisabled={isAsNeeded}
        onChange={(v) => onChange({ reminders: v })}
      />
      <TText variant="meta" color="soft">
        Reminders stay on your phone. They never include health details unless you choose to show names in Tracker settings.
      </TText>
    </View>
  );
}

export function ReviewStep({ form, storeName, onEdit }: { form: ProtocolForm; storeName: string; onEdit: (step: SetupStep) => void }) {
  const th = useTrackerTheme();
  const result = formToProtocol(form);
  if (!result.ok) {
    return (
      <Card tone="alt">
        <TText variant="bodyStrong" color={th.status.low.text}>
          {result.reason}
        </TText>
      </Card>
    );
  }
  const p = result.protocol;
  const mixText = p.mix ? `${p.mix.vialAmount} ${unitLabel(p.mix.vialUnit)} vial + ${p.mix.waterMl} mL water` : null;
  const dates = `From ${formatDay(p.startDate)}${p.endDate ? ` to ${formatDay(p.endDate)}` : ""}`;

  return (
    <View style={styles.wrap}>
      {form.source?.kind === "guide" ? <GuideNotice storeName={storeName} /> : null}
      <Section title="What" onEdit={() => onEdit("compound")}>
        <View style={styles.nameRow}>
          <Dot color={p.color} size={14} />
          <TText variant="title" style={styles.fill}>
            {p.name}
          </TText>
        </View>
      </Section>
      <Section title="Dose" onEdit={() => onEdit("dose")}>
        <TText variant="headline" tabular>
          {formatDose(p.dose)}
        </TText>
        {mixText ? (
          <TText variant="meta" color="soft">
            {mixText}
          </TText>
        ) : null}
      </Section>
      <Section title="Schedule" onEdit={() => onEdit("schedule")}>
        <TText variant="bodyStrong">{describeSchedule(p)}</TText>
        <TText variant="meta" color="soft">
          {dates}
        </TText>
        {p.halfLifeHours ? (
          <TText variant="meta" color="soft">{`Half-life ${p.halfLifeHours} h (for the estimated level chart)`}</TText>
        ) : null}
      </Section>
      <Section title="Reminders" onEdit={() => onEdit("reminders")}>
        <TText variant="bodyStrong">{p.reminders && p.schedule.kind !== "asNeeded" ? "On at each dose time" : "Off"}</TText>
      </Section>
    </View>
  );
}

export function GuideNotice({ storeName }: { storeName: string }) {
  const th = useTrackerTheme();
  return (
    <View style={[styles.notice, { backgroundColor: th.status.low.soft }]} accessible accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={20} color={th.status.low.text} />
      <TText variant="meta" color={th.status.low.text} style={styles.fill}>
        {`From ${storeName}’s guide. Check every number with your doctor before you save.`}
      </TText>
    </View>
  );
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card>
      <View style={styles.sectionHead}>
        <TText variant="micro" color="faint" accessibilityRole="header" style={styles.fill}>
          {title}
        </TText>
        <PressButton label="Edit" tone="ghost" size="sm" accessibilityLabel={`Edit ${title.toLowerCase()}`} onPress={onEdit} />
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: TSPACE.lg },
  fill: { flex: 1 },
  center: { alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: -TSPACE.sm, marginBottom: -TSPACE.sm },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: TSPACE.sm, padding: TSPACE.md, borderRadius: TRADIUS.md },
});
