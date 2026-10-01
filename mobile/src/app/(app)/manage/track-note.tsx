import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { IconButton } from "@/features/admin/catalog/components";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import {
  MAX_TRACK_NOTE_ROWS,
  TRACK_CELL_MAX,
  TRACK_FOOTNOTE_MAX,
  TRACK_NOTE_EXAMPLE,
  TRACK_TITLE_MAX,
  isBusinessLocked,
  isTrackNoteVisible,
  normalizeTrackNote,
  type TrackNote,
} from "@/features/admin/rules/content";
import { TrackNotePreview } from "@/features/admin/rules/previews";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

/**
 * The website's Delivery Note (AdminTrackNote → saveTrackNoteAction): the info
 * card under the order-number box on the Track Order page — a title, region →
 * estimate rows and a footnote. Business-exclusive, locked during a trial or
 * without the entitlement (the same rule the website tile and the save apply).
 */
export default function TrackNoteScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Delivery note" }} />
      <Loadable query={brand}>
        {(b) =>
          isBusinessLocked(b, "trackNoteEntitled") ? (
            <EmptyState
              icon="lock-closed-outline"
              title="Delivery Note is a Business feature"
              body="Upgrade to Business to show courier delivery estimates on your Track Order page."
            />
          ) : (
            <Editor brand={b} />
          )
        }
      </Loadable>
    </>
  );
}

type RowDraft = { key: number; region: string; estimate: string };

// Stable list keys for rows on this phone only (never sent to the server).
let rowSeq = 0;
const keyed = (n: Pick<TrackNote, "rows">): RowDraft[] => n.rows.map((r) => ({ key: rowSeq++, ...r }));
type Draft = { enabled: boolean; title: string; subtitle: string; rows: RowDraft[]; footnote: string };

/** Exactly what the website form sends — the server drops blank rows and caps the copy. */
const payloadOf = (d: Draft) => ({
  enabled: d.enabled,
  title: d.title,
  subtitle: d.subtitle,
  rows: d.rows.map(({ region, estimate }) => ({ region, estimate })),
  footnote: d.footnote,
});

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState(() => normalizeTrackNote(brand.trackNote));
  const [draft, setDraft] = useState<Draft>(() => ({ ...saved, rows: keyed(saved) }));
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveTrackNoteAction");

  // As it will persist, so the preview and the dirty check match what ships.
  const preview = normalizeTrackNote(payloadOf(draft));
  const dirty = JSON.stringify(preview) !== JSON.stringify(saved);
  useDiscardGuard(dirty);
  const live = isTrackNoteVisible(preview);

  const update = (patch: Partial<Draft>) => {
    hideSaved();
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setRow = (key: number, patch: Partial<RowDraft>) =>
    update({ rows: draft.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const addRow = () => update({ rows: [...draft.rows, { key: rowSeq++, region: "", estimate: "" }] });
  const removeRow = (key: number) => update({ rows: draft.rows.filter((r) => r.key !== key) });

  // Fills the fields only — never saves or switches the card on (as on the website).
  function loadExample() {
    const fill = () =>
      update({
        title: TRACK_NOTE_EXAMPLE.title,
        subtitle: TRACK_NOTE_EXAMPLE.subtitle,
        rows: keyed(TRACK_NOTE_EXAMPLE),
        footnote: TRACK_NOTE_EXAMPLE.footnote,
      });
    const hasCopy = !!(draft.title || draft.subtitle || draft.footnote || draft.rows.some((r) => r.region || r.estimate));
    if (!hasCopy) return fill();
    Alert.alert("Replace your delivery note?", "The example replaces the title, rows and footnote below. Nothing is saved until you tap Save.", [
      { text: "Cancel", style: "cancel" },
      { text: "Load example", onPress: fill },
    ]);
  }

  function onSave() {
    save.mutate(payloadOf(draft), {
      onSuccess: () => {
        setSaved(preview);
        setDraft({ ...preview, rows: keyed(preview) });
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const full = draft.rows.length >= MAX_TRACK_NOTE_ROWS;

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <Section
        title="Track-page delivery note"
        hint="A small info card shown on your Track Order page, right under the order-number search box. Use it for courier delivery estimates or any short shipping note."
      >
        <Pill
          tone={live ? "success" : "neutral"}
          icon={live ? "eye-outline" : "eye-off-outline"}
          label={live ? "Shown on Track Order" : "Not shown to customers"}
        />
        <ToggleRow
          label="Show the delivery note on my Track Order page"
          hint="Turn it off to hide the card without losing your copy."
          value={draft.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <Button label="Load J&T Davao example" icon="document-text-outline" variant="secondary" onPress={loadExample} />
        <Hint>Fills the fields below with a sample courier table you can keep or edit.</Hint>
      </Section>

      <Section title="Heading">
        <Field
          label="Title"
          value={draft.title}
          onChangeText={(title) => update({ title })}
          maxLength={TRACK_TITLE_MAX}
          placeholder="J&T Express Delivery Estimates"
        />
        <Field
          label="Subtitle"
          value={draft.subtitle}
          onChangeText={(subtitle) => update({ subtitle })}
          maxLength={TRACK_TITLE_MAX}
          placeholder="from Davao City"
          hint="A short qualifier next to the title. Leave blank to hide."
        />
      </Section>

      <Section title="Rows" hint={`One region per row. They fill a two-column grid top-to-bottom. ${draft.rows.length}/${MAX_TRACK_NOTE_ROWS}`}>
        {draft.rows.length === 0 ? (
          <AppText variant="caption" color="faint">
            No rows yet.
          </AppText>
        ) : null}
        {draft.rows.map((row, i) => (
          <View key={row.key} style={styles.row}>
            <View style={styles.cell}>
              <Field
                label={`Region ${i + 1}`}
                value={row.region}
                onChangeText={(region) => setRow(row.key, { region })}
                maxLength={TRACK_CELL_MAX}
                placeholder="Mindanao"
              />
            </View>
            <View style={styles.cell}>
              <Field
                label="Estimate"
                value={row.estimate}
                onChangeText={(estimate) => setRow(row.key, { estimate })}
                maxLength={TRACK_CELL_MAX}
                placeholder="1–5 days"
              />
            </View>
            <View style={styles.remove}>
              <IconButton icon="trash-outline" tone="danger" label={`Remove row ${i + 1}`} onPress={() => removeRow(row.key)} />
            </View>
          </View>
        ))}
        <Button label="Add a row" icon="add" variant="secondary" disabled={full} onPress={addRow} />
        {full ? <Hint>{`That's the maximum of ${MAX_TRACK_NOTE_ROWS} rows.`}</Hint> : null}
      </Section>

      <Section title="Footnote">
        <Field
          label="Footnote"
          value={draft.footnote}
          onChangeText={(footnote) => update({ footnote })}
          maxLength={TRACK_FOOTNOTE_MAX}
          multiline
          placeholder="* Sending day not counted. · Business days only."
          hint="Fine print under the grid. Leave blank to hide."
        />
      </Section>

      <Section title="Preview" hint={draft.enabled ? "What customers see on Track Order." : "Currently hidden from customers — this is how it would look."}>
        <TrackNotePreview config={preview} />
        {draft.enabled && !live ? <Hint tone="warning">Add a title or at least one row — an empty note stays hidden.</Hint> : null}
      </Section>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: SPACE.sm, alignItems: "flex-end" },
  cell: { flex: 1 },
  remove: { paddingBottom: SPACE.sm },
});
