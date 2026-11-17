import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AdminBrand } from "@/features/admin/bridge";
import { IconButton } from "@/features/admin/catalog/components";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { ChoicePills, FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import {
  DEFAULT_TIMELINE,
  normalizeTimeline,
  TIMELINE_EXAMPLE,
  TIMELINE_LIMITS,
  TIMELINE_PLACEMENTS,
  timelineStepStates,
  type TimelineConfig,
  type TimelinePlacement,
  type TimelineStep,
} from "@/features/admin/content/timeline";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * The website's Timeline editor (AdminTimeline.tsx → saveTimelineAction): an
 * owner-written list of steps with the current one highlighted, shown on the
 * Track Order page, in the hero, or both. Owner-only and operator-granted
 * (FEATURES.STORE_TIMELINE) — the server enforces both and normalizes the copy.
 */
export default function TimelineScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Timeline" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

/** Rows carry a local id so reordering keeps the "current step" pick on its step. */
type DraftStep = TimelineStep & { id: number };

// Module-level, as in AdminTimeline.tsx — ids only need to be unique, not dense.
let nextId = 1;
const toDraft = (list: TimelineStep[]): DraftStep[] => list.map((s) => ({ ...s, id: nextId++ }));

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<TimelineConfig>(() => normalizeTimeline(brand.timeline ?? DEFAULT_TIMELINE));
  // Steps and the current pick seeded together, so the pick always names a real row id.
  const [initial] = useState(() => {
    const rows = toDraft(saved.steps);
    return { rows, currentId: rows[saved.currentStep]?.id ?? null };
  });
  const [enabled, setEnabled] = useState(saved.enabled);
  const [title, setTitle] = useState(saved.title);
  const [placement, setPlacement] = useState<TimelinePlacement>(saved.placement);
  const [steps, setSteps] = useState<DraftStep[]>(initial.rows);
  const [currentId, setCurrentId] = useState<number | null>(initial.currentId);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveTimelineAction");

  const payload = {
    enabled,
    title,
    placement,
    steps: steps.map(({ title: t, date, note }) => ({ title: t, date, note })),
    currentStep: steps.findIndex((s) => s.id === currentId),
  };
  // What will persist (blank-title steps dropped, current index clamped).
  const draft = normalizeTimeline(payload);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useDiscardGuard(dirty);

  const edit =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      hideSaved();
      fn(v);
    };
  const updateStep = (id: number, patch: Partial<TimelineStep>) => {
    hideSaved();
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const removeStep = (id: number) => {
    hideSaved();
    setSteps((list) => list.filter((s) => s.id !== id));
    if (currentId === id) setCurrentId(null);
  };
  const moveStep = (index: number, delta: -1 | 1) => {
    hideSaved();
    setSteps((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const addStep = () => {
    hideSaved();
    setSteps((list) => [...list, { id: nextId++, title: "", date: "", note: "" }]);
  };
  const loadExample = () => {
    const apply = () => {
      hideSaved();
      const example = toDraft(TIMELINE_EXAMPLE.steps);
      setTitle(TIMELINE_EXAMPLE.title);
      setPlacement(TIMELINE_EXAMPLE.placement);
      setSteps(example);
      setCurrentId(example[TIMELINE_EXAMPLE.currentStep]?.id ?? null);
    };
    if (!steps.length) return apply();
    Alert.alert("Replace your steps?", "The group-buy example replaces the heading and steps you have now.", [
      { text: "Cancel", style: "cancel" },
      { text: "Replace", style: "destructive", onPress: apply },
    ]);
  };

  function onSave() {
    save.mutate(payload, {
      onSuccess: () => {
        setSaved(draft);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <Section
        title="Timeline"
        hint="A list of steps with the current one highlighted, e.g. your group-buy schedule. Update the current step as the round moves along."
      >
        <ToggleRow label="Show the timeline on my store" hint="Turn it off to hide it without losing your steps." value={enabled} onChange={edit(setEnabled)} />
        <ChoicePills
          label="Where should it show?"
          options={TIMELINE_PLACEMENTS.map((p) => ({ key: p.value, label: p.label }))}
          value={placement}
          onChange={edit(setPlacement)}
        />
        <Field label="Heading" value={title} onChangeText={edit(setTitle)} maxLength={TIMELINE_LIMITS.title} placeholder="Group buy schedule" hint="Leave blank to hide it." />
        <Button label="Load group-buy example" icon="sparkles-outline" variant="secondary" onPress={loadExample} />
      </Section>

      <Section title="Steps" hint={`Up to ${TIMELINE_LIMITS.steps} steps. Steps without a title aren't saved. Tap a circle to mark the current step.`}>
        <CurrentChoice label="Not started yet (no step highlighted)" active={currentId === null} onPress={() => edit(setCurrentId)(null)} />
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            index={i}
            step={step}
            count={steps.length}
            current={currentId === step.id}
            onCurrent={() => edit(setCurrentId)(step.id)}
            onChange={(patch) => updateStep(step.id, patch)}
            onMove={(delta) => moveStep(i, delta)}
            onRemove={() => removeStep(step.id)}
          />
        ))}
        <Button label="Add step" icon="add" variant="secondary" disabled={steps.length >= TIMELINE_LIMITS.steps} onPress={addStep} />
      </Section>

      <Section title="Preview" hint={enabled ? "What customers see." : "Currently hidden from customers. This is how it would look."}>
        {draft.steps.length ? <TimelinePreview config={draft} /> : <Hint>Add a step to see the preview.</Hint>}
        <Hint>
          {placement === "both"
            ? "Shows on the Track Order page and in the hero. Notes appear on the Track page only."
            : placement === "hero"
              ? "Shows in the hero section."
              : "Shows on the Track Order page."}
        </Hint>
      </Section>
    </FormPage>
  );
}

function CurrentChoice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={styles.radioRow} hitSlop={6}>
      <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={22} color={active ? t.brand.primary : t.colors.textFaint} />
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

function StepCard({
  index,
  step,
  count,
  current,
  onCurrent,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  step: DraftStep;
  count: number;
  current: boolean;
  onCurrent: () => void;
  onChange: (patch: Partial<TimelineStep>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const n = index + 1;
  return (
    <View style={[styles.step, { borderColor: current ? t.brand.primary : t.colors.border }]}>
      <View style={styles.stepHead}>
        <View style={{ flex: 1 }}>
          <CurrentChoice label={`Step ${n}${current ? " (current step)" : ""}`} active={current} onPress={onCurrent} />
        </View>
        <IconButton icon="chevron-up" label={`Move step ${n} up`} disabled={index === 0} onPress={() => onMove(-1)} />
        <IconButton icon="chevron-down" label={`Move step ${n} down`} disabled={index === count - 1} onPress={() => onMove(1)} />
        <IconButton icon="trash-outline" label={`Remove step ${n}`} tone="danger" onPress={onRemove} />
      </View>
      <Field label="Title" value={step.title} onChangeText={(v) => onChange({ title: v })} maxLength={TIMELINE_LIMITS.stepTitle} placeholder="Orders close" />
      <Field label="Date (optional)" value={step.date} onChangeText={(v) => onChange({ date: v })} maxLength={TIMELINE_LIMITS.date} placeholder="Nov 1 or ~Nov 12" />
      <Field
        label="Note (optional, Track page only)"
        value={step.note}
        onChangeText={(v) => onChange({ note: v })}
        maxLength={TIMELINE_LIMITS.note}
        multiline
        placeholder="Last day to join this round."
      />
    </View>
  );
}

/** A native stand-in for the storefront's TimelineCard: done / current / upcoming. */
function TimelinePreview({ config }: { config: TimelineConfig }) {
  const t = useTheme();
  const states = timelineStepStates(config);
  return (
    <View style={[styles.preview, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}>
      {config.title ? <AppText variant="heading">{config.title}</AppText> : null}
      {config.steps.map((s, i) => {
        const state = states[i];
        return (
          <View key={i} style={styles.previewRow}>
            <Ionicons
              name={state === "done" ? "checkmark-circle" : state === "current" ? "radio-button-on" : "ellipse-outline"}
              size={20}
              color={state === "upcoming" ? t.colors.textFaint : t.brand.primary}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant={state === "current" ? "bodyStrong" : "body"} color={state === "upcoming" ? "muted" : "text"}>
                {s.date ? `${s.title}  ·  ${s.date}` : s.title}
              </AppText>
              {s.note ? (
                <AppText variant="caption" color="muted">
                  {s.note}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  radioRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 36 },
  step: { gap: SPACE.md, padding: SPACE.md, borderWidth: 1, borderRadius: RADIUS.md },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 2 },
  preview: { gap: SPACE.md, padding: SPACE.lg, borderRadius: RADIUS.md, borderWidth: 1 },
  previewRow: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm },
});
