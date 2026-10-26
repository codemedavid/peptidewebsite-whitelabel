import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { success } from "@/features/admin/setup/data";
import { isoToLocal, localToIso } from "@/features/admin/group-buys/model";
import { ChoicePills, FormPage, Hint, SaveBar, Section, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, Button } from "@/ui/primitives";
import { PaidAccessError, useSavePaidAccessSettings } from "./hooks";
import {
  applyPreset,
  PAID_ACCESS_PRESETS,
  PAID_ACCESS_STEPS,
  centsLabel,
  centsToInput,
  detectPreset,
  parseAmountCents,
  previewSteps,
  type PaidAccessSettings,
  type PaidAccessStep,
  type SettingsError,
  type SettingsView,
} from "./model";
import { QuestionsEditor } from "./QuestionsEditor";
import { AudienceSection, CapacitySection, CopySection, PaymentSection, ScheduleSection, type EditorTexts } from "./SettingsSections";

/**
 * One round's Join settings (savePaidAccessSettingsAction): a preset, the step
 * order, and the fields each step needs, with a live preview of what a member
 * walks through. The server validates every save; its field errors are shown
 * next to the field whose `path` they name.
 */

const STEP_NAME: Record<PaidAccessStep, string> = { form: "Application form", payment: "Payment", approval: "Admin approval" };
const SLOTS_RE = /^\d{1,6}$/;

const textsOf = (s: PaidAccessSettings): EditorTexts => ({
  amount: centsToInput(s.payment.amountCents),
  limitSlots: s.capacity.maxSlots !== null,
  slots: s.capacity.maxSlots === null ? "" : String(s.capacity.maxSlots),
  opensAt: isoToLocal(s.schedule.opensAt),
  closesAt: isoToLocal(s.schedule.closesAt),
});

/** Draft + typed text → settings to send, or the local errors that stop the save. */
function build(draft: PaidAccessSettings, texts: EditorTexts): { settings: PaidAccessSettings } | { errors: SettingsError[] } {
  const errors: SettingsError[] = [];
  const paid = draft.steps.includes("payment");
  const amount = parseAmountCents(texts.amount);
  if (paid && !amount.ok) errors.push({ path: "payment.amountCents", message: amount.error });
  const slots = texts.slots.trim();
  const maxSlots = texts.limitSlots ? (SLOTS_RE.test(slots) && Number(slots) >= 1 ? Number(slots) : null) : null;
  if (texts.limitSlots && maxSlots === null) errors.push({ path: "capacity.maxSlots", message: "Enter the number of slots (1 or more)." });
  const opensAt = localToIso(texts.opensAt);
  const closesAt = localToIso(texts.closesAt);
  if (opensAt === undefined) errors.push({ path: "schedule.opensAt", message: "Use YYYY-MM-DD HH:MM, or leave it blank." });
  if (closesAt === undefined) errors.push({ path: "schedule.closesAt", message: "Use YYYY-MM-DD HH:MM, or leave it blank." });
  if (errors.length) return { errors };
  return {
    settings: {
      ...draft,
      payment: { ...draft.payment, amountCents: amount.ok ? amount.value : draft.payment.amountCents },
      capacity: { maxSlots, waitlist: maxSlots === null ? false : draft.capacity.waitlist },
      schedule: { opensAt: opensAt ?? null, closesAt: closesAt ?? null },
    },
  };
}

const move = (steps: PaidAccessStep[], i: number, by: number): PaidAccessStep[] => {
  const next = [...steps];
  const [s] = next.splice(i, 1);
  next.splice(i + by, 0, s);
  return next;
};

type Props = { groupBuyId: string; view: SettingsView; currency: string };

export function SettingsEditor({ groupBuyId, view, currency }: Props) {
  const save = useSavePaidAccessSettings(groupBuyId);
  const start = view.exists ? view.settings : view.suggested;
  const [saved, setSaved] = useState(() => JSON.stringify({ s: view.exists ? view.settings : null, t: textsOf(view.settings) }));
  const [draft, setDraft] = useState<PaidAccessSettings>(start);
  const [texts, setTexts] = useState<EditorTexts>(() => textsOf(start));
  const [errors, setErrors] = useState<SettingsError[]>([]);
  const [shown, flash, clearFlash] = useSavedFlash();

  const dirty = JSON.stringify({ s: draft, t: texts }) !== saved;
  const allowLeave = useDiscardGuard(dirty);
  const errorFor = (path: string) => errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))?.message ?? null;

  const onDraft = (next: PaidAccessSettings) => {
    setDraft(next);
    setErrors([]);
    clearFlash();
  };
  const onTexts = (patch: Partial<EditorTexts>) => {
    setTexts((prev) => ({ ...prev, ...patch }));
    setErrors([]);
    clearFlash();
  };

  const submit = () => {
    const built = build(draft, texts);
    if ("errors" in built) return setErrors(built.errors);
    save.mutate(built.settings, {
      onSuccess: (fresh) => {
        success();
        setDraft(fresh.settings);
        setTexts(textsOf(fresh.settings));
        setSaved(JSON.stringify({ s: fresh.settings, t: textsOf(fresh.settings) }));
        allowLeave();
        flash();
      },
      onError: (e) => setErrors(e instanceof PaidAccessError && e.errors.length ? e.errors : [{ path: "", message: e.message }]),
    });
  };

  const amount = parseAmountCents(texts.amount);
  const preview = previewSteps(draft, centsLabel(currency, amount.ok ? amount.value : draft.payment.amountCents));
  const preset = detectPreset(draft);
  const general = errors.find((e) => !e.path)?.message;
  const sectionProps = { draft, texts, onDraft, onTexts, errorFor };

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={shown} onSave={submit} />}>
      {!view.exists ? <Hint>Not set up yet — this round stays members-only and nobody can join until you save how customers get in.</Hint> : null}
      {general ? <Hint tone="danger">{general}</Hint> : null}

      <Section title="How customers join" hint={PAID_ACCESS_PRESETS.find((p) => p.id === preset)?.description ?? "A custom step order."}>
        <ChoicePills
          label="Preset"
          options={PAID_ACCESS_PRESETS.map((p) => ({ key: p.id, label: p.label }))}
          value={preset === "custom" ? "" : preset}
          onChange={(id) => onDraft(applyPreset(id, draft))}
        />
        <StepsEditor steps={draft.steps} onChange={(steps) => onDraft({ ...draft, steps })} error={errorFor("steps")} />
        <Preview steps={preview} />
      </Section>

      {draft.steps.includes("form") ? (
        <Section title="Application form" hint="Members answer these before anything else.">
          <QuestionsEditor questions={draft.form.questions} onChange={(questions) => onDraft({ ...draft, form: { questions } })} errorFor={errorFor} />
        </Section>
      ) : null}
      {draft.steps.includes("payment") ? <PaymentSection {...sectionProps} currency={currency} onlineAvailable={view.onlinePaymentsAvailable} /> : null}
      <CapacitySection {...sectionProps} slotsTaken={view.slotsTaken} />
      <ScheduleSection {...sectionProps} />
      <AudienceSection {...sectionProps} />
      <CopySection {...sectionProps} />
      {view.exists ? <Hint>Members who already joined keep the rules they joined under. Version {view.version}.</Hint> : null}
    </FormPage>
  );
}

function StepsEditor({ steps, onChange, error }: { steps: PaidAccessStep[]; onChange: (s: PaidAccessStep[]) => void; error: string | null }) {
  const t = useTheme();
  const missing = PAID_ACCESS_STEPS.filter((s) => !steps.includes(s));
  const icon = (name: "arrow-up" | "arrow-down" | "close", label: string, disabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={[styles.iconBtn, { borderColor: t.colors.border, opacity: disabled ? 0.35 : 1 }]}
    >
      <Ionicons name={name} size={18} color={t.colors.text} />
    </Pressable>
  );
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">
        Steps, in order
      </AppText>
      {steps.length === 0 ? <Hint>No steps — anyone gets in instantly.</Hint> : null}
      {steps.map((s, i) => (
        <View key={s} style={[styles.stepRow, { borderColor: t.colors.border, backgroundColor: t.colors.bg }]}>
          <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {`${i + 1}. ${STEP_NAME[s]}`}
          </AppText>
          {icon("arrow-up", `Move ${STEP_NAME[s]} up`, i === 0, () => onChange(move(steps, i, -1)))}
          {icon("arrow-down", `Move ${STEP_NAME[s]} down`, i === steps.length - 1, () => onChange(move(steps, i, 1)))}
          {icon("close", `Remove ${STEP_NAME[s]}`, false, () => onChange(steps.filter((x) => x !== s)))}
        </View>
      ))}
      {missing.length ? (
        <View style={styles.addRow}>
          {missing.map((s) => (
            <Button key={s} label={`Add ${STEP_NAME[s].toLowerCase()}`} icon="add" variant="ghost" onPress={() => onChange([...steps, s])} />
          ))}
        </View>
      ) : null}
      {error ? <Hint tone="danger">{error}</Hint> : null}
    </View>
  );
}

function Preview({ steps }: { steps: string[] }) {
  const t = useTheme();
  return (
    <View style={[styles.preview, { backgroundColor: t.colors.surfaceAlt }]} accessible accessibilityLabel={`Members see: ${steps.join(", then ")}`}>
      <AppText variant="overline" color="muted">
        WHAT MEMBERS SEE
      </AppText>
      <View style={styles.chain}>
        {steps.map((s, i) => (
          <View key={`${i}-${s}`} style={styles.chainItem}>
            <View style={[styles.chainDot, { backgroundColor: i === steps.length - 1 ? t.brand.primary : t.colors.surface, borderColor: t.brand.primary }]}>
              <AppText variant="caption" color={i === steps.length - 1 ? "onPrimary" : "link"}>
                {String(i + 1)}
              </AppText>
            </View>
            <AppText variant="label">{s}</AppText>
            {i < steps.length - 1 ? <Ionicons name="chevron-forward" size={14} color={t.colors.textMuted} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.sm, paddingLeft: SPACE.md, borderRadius: RADIUS.md, borderWidth: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs },
  preview: { gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.lg },
  chain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", rowGap: SPACE.sm, columnGap: SPACE.xs },
  chainItem: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, minHeight: TOUCH / 2 },
  chainDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});
