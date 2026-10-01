import { useState } from "react";
import { View } from "react-native";
import { str, type Row } from "../setup/rules";
import { ChoicePills, EditorSheet, Hint, Section } from "../setup/ui";
import { GalleryEditor } from "./parts";
import {
  MAX_PROTOCOL_FIELD,
  MAX_PROTOCOL_IMAGES,
  MAX_PROTOCOL_NAME,
  MAX_PROTOCOL_STORAGE,
  protocolImages,
  protocolMode,
  type ProtocolMode,
} from "./rules";
import { Field } from "@/ui/inputs";

const MODES: { key: ProtocolMode; label: string }[] = [
  { key: "details", label: "Type the details" },
  { key: "image", label: "Upload an image" },
];

/**
 * One protocol's form (the web's editor card in AdminProtocolsManager). "Done"
 * hands the edited row back to the list; the list's Save Changes persists it.
 */
export function ProtocolEditor({
  initial,
  isNew,
  categories,
  onCancel,
  onDone,
}: {
  initial: Row;
  isNew: boolean;
  categories: string[];
  onCancel: () => void;
  onDone: (row: Row) => void;
}) {
  const startNotes = Array.isArray(initial.notes) ? initial.notes.map((n) => String(n ?? "")).join("\n") : "";
  const [name, setName] = useState(str(initial.name));
  const [category, setCategory] = useState(str(initial.category));
  const [mode, setMode] = useState<ProtocolMode>(protocolMode(initial));
  const [dosage, setDosage] = useState(str(initial.dosage));
  const [frequency, setFrequency] = useState(str(initial.frequency));
  const [duration, setDuration] = useState(str(initial.duration));
  const [notes, setNotes] = useState(startNotes);
  const [storage, setStorage] = useState(str(initial.storage));
  const [images, setImages] = useState<string[]>(() => protocolImages(initial));

  // A category saved before the list changed still shows (and stays) selected.
  const options = (category && !categories.includes(category) ? [category, ...categories] : categories).map((c) => ({ key: c, label: c }));
  const dirty =
    isNew ||
    name !== str(initial.name) ||
    category !== str(initial.category) ||
    mode !== protocolMode(initial) ||
    dosage !== str(initial.dosage) ||
    frequency !== str(initial.frequency) ||
    duration !== str(initial.duration) ||
    notes !== startNotes ||
    storage !== str(initial.storage) ||
    JSON.stringify(images) !== JSON.stringify(protocolImages(initial));

  const gallery = (hint: string) => (
    <View style={{ gap: 8 }}>
      <Hint>{hint}</Hint>
      <GalleryEditor images={images} max={MAX_PROTOCOL_IMAGES} label={name || "protocol"} onChange={setImages} />
    </View>
  );

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Protocol" : "Edit Protocol"}
      saveLabel="Done"
      canSave
      dirty={dirty}
      onCancel={onCancel}
      onSave={() =>
        onDone({
          ...initial,
          name,
          category,
          mode,
          dosage,
          frequency,
          duration,
          // "Notes (one per line)" — the web drops blank lines.
          notes: notes.split("\n").filter(Boolean),
          storage,
          images,
        })
      }
    >
      <Field label="Protocol name" value={name} onChangeText={setName} placeholder="Protocol name" maxLength={MAX_PROTOCOL_NAME} />
      {options.length > 0 ? <ChoicePills label="Category" options={options} value={category} onChange={setCategory} /> : null}
      <Section title="How do you want to show this protocol?" hint="Choose one: type out the details, or upload a single image (e.g. a dosing chart) that says it all.">
        <ChoicePills label="Presentation" options={MODES} value={mode} onChange={setMode} />
      </Section>

      {mode === "image" ? (
        <Section title="Protocol images">
          {gallery(
            `Upload one or more images (e.g. dosing charts or infographics). They replace the typed details on the public page. Up to ${MAX_PROTOCOL_IMAGES} — JPG, PNG, WebP, max 10 MB each.`,
          )}
        </Section>
      ) : (
        <>
          <Field label="Dosage" value={dosage} onChangeText={setDosage} placeholder="e.g. 1-2mg daily" maxLength={MAX_PROTOCOL_FIELD} />
          <Field label="Frequency" value={frequency} onChangeText={setFrequency} placeholder="e.g. Once weekly" maxLength={MAX_PROTOCOL_FIELD} />
          <Field label="Duration" value={duration} onChangeText={setDuration} placeholder="e.g. 8-12 weeks" maxLength={MAX_PROTOCOL_FIELD} />
          <Field label="Notes (one per line)" value={notes} onChangeText={setNotes} placeholder={"Note 1\nNote 2\nNote 3"} multiline />
          <Field
            label="Storage instructions"
            value={storage}
            onChangeText={setStorage}
            placeholder="e.g. Refrigerate at 2-8°C…"
            maxLength={MAX_PROTOCOL_STORAGE}
          />
          <Section title="Images (optional)">
            {gallery(`Add supporting images shown below the details on the public page. Up to ${MAX_PROTOCOL_IMAGES}.`)}
          </Section>
        </>
      )}
    </EditorSheet>
  );
}
