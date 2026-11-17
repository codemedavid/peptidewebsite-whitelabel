import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import { PreviewPublicPage, ViewGate } from "@/features/admin/content/page-guard";
import type { AdminBrand } from "@/features/admin/bridge";
import { brandCategories } from "@/features/admin/catalog/model";
import { listFrom, useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { str, type Row } from "@/features/admin/setup/rules";
import { FormPage, Hint, ItemCard, Loadable, SaveBar, Section, confirmDelete, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { ProtocolEditor } from "@/features/admin/content/ProtocolEditor";
import { Thumb } from "@/features/admin/content/parts";
import { MAX_PROTOCOLS, newProtocol, protocolImages, protocolMode } from "@/features/admin/content/rules";
import { SEED_PROTOCOLS } from "@/features/admin/content/seeds";
import { EmptyState } from "@/ui/feedback";
import { AppText, Button, Pill } from "@/ui/primitives";
/** src/lib/storefront/linkify.ts OWNER_NOTE_MAX (the server trims and caps it too). */
const OWNER_NOTE_MAX = 400;

/**
 * The website's Protocols (AdminProtocolsManager → saveProtocolsAction): the
 * public dosing guide. Each protocol is either typed out (dosage, frequency,
 * duration, notes, storage + optional images) or shown as uploaded images.
 * Like the web, edits collect locally and go up together with Save Changes.
 */
export default function ProtocolsScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Protocols" }} />
      <Loadable query={brand}>
        {(b) => (
          <ViewGate brand={b} view="proto" label="Protocols">
            <Editor brand={b} />
          </ViewGate>
        )}
      </Loadable>
    </>
  );
}

type Editing = { index: number | null; row: Row };

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<Row[]>(() => listFrom(brand, "protocols", SEED_PROTOCOLS));
  const [list, setList] = useState<Row[]>(saved);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveProtocolsAction");
  // The note under the Protocols page title (brand.protocolsNote) — saved by the
  // same Save Changes as the list, as on the website (saveProtocolsNoteAction).
  const [savedNote, setSavedNote] = useState(() => (typeof brand.protocolsNote === "string" ? brand.protocolsNote : ""));
  const [note, setNote] = useState(savedNote);
  const saveNote = useSetupSave("saveProtocolsNoteAction");

  const listDirty = JSON.stringify(list) !== JSON.stringify(saved);
  const noteDirty = note.trim() !== savedNote.trim();
  const dirty = listDirty || noteDirty;
  useDiscardGuard(dirty);
  // The web's category <select> lists every real category by LABEL.
  const categories = brandCategories(brand)
    .filter((c) => c.id !== "all")
    .map((c) => c.label);

  const edit = (next: Row[]) => {
    hideSaved();
    setList(next);
  };
  const atCap = list.length >= MAX_PROTOCOLS;

  async function onSave() {
    try {
      if (listDirty) {
        await save.mutateAsync(list);
        setSaved(list);
      }
      if (noteDirty) {
        await saveNote.mutateAsync(note).catch((e: Error) => {
          throw new Error(`Couldn't save the note: ${e.message}`);
        });
        setSavedNote(note.trim().slice(0, OWNER_NOTE_MAX));
      }
      showSaved();
    } catch (e) {
      Alert.alert("Couldn't save protocols", e instanceof Error ? e.message : "Please try again.");
    }
  }

  return (
    <>
      <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending || saveNote.isPending} saved={flash} disabled={!dirty} label="Save Changes" onSave={() => void onSave()} />}>
        <AppText variant="body" color="muted">
          The dosing guides on your public Protocols page. Tap a protocol to edit it, then Save Changes.
        </AppText>
        <PreviewPublicPage hash="protocols" />
        <Section
          title="Page note"
          hint="Shown in a highlighted box under the Protocols page title. Type a web address like www.yoursite.com and it becomes a clickable link. Leave it empty to hide the box."
        >
          <Field
            label="Note"
            value={note}
            onChangeText={(v) => {
              hideSaved();
              setNote(v.slice(0, OWNER_NOTE_MAX));
            }}
            maxLength={OWNER_NOTE_MAX}
            multiline
            placeholder="e.g. To access more protocols, please visit our Peptide Library at www.yoursite.com."
            hint={`${note.length} / ${OWNER_NOTE_MAX}`}
          />
          {note ? (
            <Button
              label="Remove note"
              icon="trash-outline"
              variant="ghost"
              onPress={() => {
                hideSaved();
                setNote("");
              }}
            />
          ) : null}
        </Section>
        <Button label="Add Protocol" icon="add" disabled={atCap} onPress={() => setEditing({ index: null, row: newProtocol() })} />
        {atCap ? <Hint tone="warning">{`Up to ${MAX_PROTOCOLS} protocols.`}</Hint> : null}

        {list.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title="No protocols yet."
            action={{ label: "Add your first protocol", onPress: () => setEditing({ index: null, row: newProtocol() }) }}
          />
        ) : (
          list.map((p, i) => {
            const name = str(p.name) || "Untitled protocol";
            const images = protocolImages(p);
            const isImage = protocolMode(p) === "image";
            return (
              <ItemCard
                key={i}
                title={name}
                leading={<Thumb uri={images[0] ?? ""} icon="book-outline" size={52} label={`${name} image`} />}
                lines={[str(p.category), isImage ? null : [str(p.dosage), str(p.frequency)].filter(Boolean).join(" · ")]}
                badges={
                  <>
                    <Pill
                      tone={isImage ? "info" : "neutral"}
                      size="sm"
                      icon={isImage ? "image-outline" : "document-text-outline"}
                      label={isImage ? "Image guide" : "Typed details"}
                    />
                    {images.length > 0 ? <Pill tone="neutral" size="sm" label={`${images.length} image${images.length === 1 ? "" : "s"}`} /> : null}
                  </>
                }
                onEdit={() => setEditing({ index: i, row: p })}
                onDelete={() => confirmDelete("Delete this protocol?", () => edit(list.filter((_, j) => j !== i)))}
              />
            );
          })
        )}
      </FormPage>
      {editing ? (
        <ProtocolEditor
          initial={editing.row}
          isNew={editing.index === null}
          categories={categories}
          onCancel={() => setEditing(null)}
          onDone={(row) => {
            const { index } = editing;
            // New protocols land at the top, like the web's "Add Protocol".
            edit(index === null ? [row, ...list] : list.map((p, j) => (j === index ? row : p)));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
