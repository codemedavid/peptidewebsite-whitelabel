import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import type { AdminBrand } from "@/features/admin/bridge";
import { brandCategories } from "@/features/admin/catalog/model";
import { listFrom, useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { str, type Row } from "@/features/admin/setup/rules";
import { FormPage, Hint, ItemCard, Loadable, SaveBar, confirmDelete, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { ProtocolEditor } from "@/features/admin/content/ProtocolEditor";
import { Thumb } from "@/features/admin/content/parts";
import { MAX_PROTOCOLS, newProtocol, protocolImages, protocolMode } from "@/features/admin/content/rules";
import { SEED_PROTOCOLS } from "@/features/admin/content/seeds";
import { EmptyState } from "@/ui/feedback";
import { AppText, Button, Pill } from "@/ui/primitives";

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
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
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

  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
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

  function onSave() {
    save.mutate(list, {
      onSuccess: () => {
        setSaved(list);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save protocols", e.message),
    });
  }

  return (
    <>
      <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!dirty} label="Save Changes" onSave={onSave} />}>
        <AppText variant="body" color="muted">
          The dosing guides on your public Protocols page. Tap a protocol to edit it, then Save Changes.
        </AppText>
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
