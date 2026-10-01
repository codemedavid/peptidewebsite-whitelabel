import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { SPACE } from "@/theme/tokens";
import { removeRows, upsertRow, useCollection } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { isIsoDate, newId, safeHttpUrl, str, type Row } from "@/features/admin/setup/rules";
import { ChoicePills, EditorSheet, Hint, ItemCard, ListPage, Loadable, confirmDelete } from "@/features/admin/setup/ui";
import { Checkbox, ImageViewer, Thumb } from "@/features/admin/content/parts";
import { MAX_COA_NAME, MAX_COA_TEXT, coaPartners, formatReportDate, type CoaPartner } from "@/features/admin/content/rules";
import { SEED_COA_REPORTS } from "@/features/admin/content/seeds";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

const OTHER = "__other";

/**
 * The website's Lab Results (AdminLabResults → saveCoaReportsAction): the
 * certificates on the public Lab Reports page. Add/edit (name, lab, test date,
 * purity, certificate image and/or document link), per-report and bulk delete.
 * Every change saves the whole list, applied to the server's current copy.
 */
export default function LabScreen() {
  const list = useCollection("coaReports", "saveCoaReportsAction", SEED_COA_REPORTS, "lab reports");
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<unknown>>(new Set());
  const [viewing, setViewing] = useState<Row | null>(null);

  return (
    <>
      <Stack.Screen options={{ title: "Lab results" }} />
      <Loadable query={list.brand}>
        {(brand) => {
          const reports = list.items;
          const allSelected = reports.length > 0 && selected.size === reports.length;
          const startAdd = () =>
            setEditing({
              row: { id: newId("coa"), name: "", lab: "", date: new Date().toISOString().slice(0, 10), purity: "", image: "", link: "" },
              isNew: true,
            });
          const toggle = (id: unknown) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          const deleteSelected = () =>
            confirmDelete(`Delete ${selected.size} lab report(s)?`, async () => {
              if (await list.apply(removeRows(selected))) setSelected(new Set());
            });

          return (
            <>
              <ListPage
                intro="Certificates of analysis shown on your public Lab Reports page."
                addLabel="Add Lab Report"
                onAdd={startAdd}
                isEmpty={reports.length === 0}
                empty={{
                  icon: "shield-checkmark-outline",
                  title: "No lab reports yet. Add one — it'll show up on your public Lab Reports page.",
                  action: "Add your first lab report",
                }}
                refreshing={list.brand.isRefetching}
                onRefresh={() => void list.brand.refetch()}
                toolbar={
                  reports.length > 0 ? (
                    <View style={styles.bulk}>
                      <Checkbox
                        checked={allSelected}
                        label={`Select All (${reports.length})`}
                        onPress={() => setSelected(allSelected ? new Set() : new Set(reports.map((r) => r.id)))}
                      />
                      <Button
                        label={`Delete Selected${selected.size ? ` (${selected.size})` : ""}`}
                        variant="danger"
                        icon="trash-outline"
                        disabled={!selected.size || list.saving}
                        onPress={deleteSelected}
                      />
                    </View>
                  ) : null
                }
              >
                {reports.map((r) => (
                  <ReportCard
                    key={str(r.id)}
                    report={r}
                    selected={selected.has(r.id)}
                    disabled={list.saving}
                    onSelect={() => toggle(r.id)}
                    onView={() => setViewing(r)}
                    onEdit={() => setEditing({ row: r, isNew: false })}
                    onDelete={() =>
                      confirmDelete("Delete this lab report? It will also disappear from the public COA page.", async () => {
                        if (await list.apply(removeRows(new Set([r.id])))) {
                          setSelected((prev) => new Set([...prev].filter((id) => id !== r.id)));
                        }
                      })
                    }
                  />
                ))}
              </ListPage>
              {editing ? (
                <ReportEditor
                  key={str(editing.row.id)}
                  initial={editing.row}
                  isNew={editing.isNew}
                  partners={coaPartners(brand)}
                  saving={list.saving}
                  onCancel={() => setEditing(null)}
                  onSave={async (row) => {
                    if (await list.apply(upsertRow(row))) setEditing(null);
                  }}
                />
              ) : null}
              {viewing ? (
                <ImageViewer uri={str(viewing.image)} title={str(viewing.name) || "Lab report"} onClose={() => setViewing(null)}>
                  <AppText variant="caption" color="#FFFFFF">
                    {[str(viewing.lab), formatReportDate(str(viewing.date)), str(viewing.purity)].filter(Boolean).join(" · ")}
                  </AppText>
                </ImageViewer>
              ) : null}
            </>
          );
        }}
      </Loadable>
    </>
  );
}

function ReportCard({
  report,
  selected,
  disabled,
  onSelect,
  onView,
  onEdit,
  onDelete,
}: {
  report: Row;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = str(report.name) || "Untitled";
  const image = str(report.image);
  const purity = str(report.purity);
  return (
    <ItemCard
      title={name}
      leading={
        <View style={styles.leading}>
          <Checkbox checked={selected} a11yLabel={`Select ${name}`} onPress={onSelect} />
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={`View ${name} certificate`} disabled={!image} onPress={onView}>
            <Thumb uri={image} icon="document-text-outline" label={`${name} certificate`} />
          </Pressable>
        </View>
      }
      lines={[str(report.lab) || "—", formatReportDate(str(report.date))]}
      badges={
        <>
          {purity ? <Pill tone="success" size="sm" icon="checkmark" label={purity} /> : null}
          <Pill tone={image ? "info" : "neutral"} size="sm" icon="image-outline" label={image ? "Image" : "No image"} />
          <Pill tone={str(report.link) ? "info" : "neutral"} size="sm" icon="link-outline" label={str(report.link) ? "Link" : "No link"} />
        </>
      }
      disabled={disabled}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function ReportEditor({
  initial,
  isNew,
  partners,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  partners: CoaPartner[];
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const startLab = str(initial.lab);
  const knownPartner = partners.some((p) => p.label === startLab);
  const [name, setName] = useState(str(initial.name));
  const [labChoice, setLabChoice] = useState<string>(knownPartner ? startLab : startLab ? OTHER : "");
  const [labText, setLabText] = useState(knownPartner ? "" : startLab);
  const [date, setDate] = useState(str(initial.date));
  const [purity, setPurity] = useState(str(initial.purity));
  const [image, setImage] = useState(str(initial.image));
  const [link, setLink] = useState(str(initial.link));

  // With partner labs the web offers a picker + "Other (type below)"; without, a text box.
  const lab = partners.length === 0 || labChoice === OTHER ? labText : labChoice;
  const dateError = date.trim() && !isIsoDate(date.trim()) ? "Use the format YYYY-MM-DD, e.g. 2026-04-12." : null;
  // The server keeps http(s) links only — say so instead of silently dropping it.
  const linkError = link.trim() && !safeHttpUrl(link) ? "Use a full link starting with https://" : null;
  const canSave = !!name.trim() && !dateError && !linkError;
  const dirty =
    name !== str(initial.name) ||
    lab !== startLab ||
    date !== str(initial.date) ||
    purity !== str(initial.purity) ||
    image !== str(initial.image) ||
    link !== str(initial.link);

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Lab Report" : "Edit Lab Report"}
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() => onSave({ ...initial, name, lab, date: date.trim(), purity, image, link: link.trim() })}
    >
      <Field label="Product / Report name *" value={name} onChangeText={setName} placeholder="e.g., BPC-157 5mg" maxLength={MAX_COA_NAME} />
      {partners.length > 0 ? (
        <>
          <ChoicePills
            label="Lab"
            options={[...partners.map((p) => ({ key: p.label, label: p.label })), { key: OTHER, label: "Other (type below)" }]}
            value={labChoice}
            onChange={setLabChoice}
          />
          {labChoice === OTHER ? (
            <Field label="Lab name" value={labText} onChangeText={setLabText} placeholder="Lab name" maxLength={MAX_COA_TEXT} />
          ) : null}
        </>
      ) : (
        <Field label="Lab" value={labText} onChangeText={setLabText} placeholder="e.g., Janoshik Analytical" maxLength={MAX_COA_TEXT} />
      )}
      <Field
        label="Test date"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={dateError}
      />
      <Field label="Purity (optional)" value={purity} onChangeText={setPurity} placeholder="e.g., 99.2%" maxLength={MAX_COA_TEXT} />
      <ImageField label="Certificate image" hint="PNG, JPG — keep it under 2.5 MB" value={image} previewAspect={3 / 4} onChange={(url) => setImage(url)} />
      <Hint>— and / or —</Hint>
      <Field
        label="Document link"
        value={link}
        onChangeText={setLink}
        placeholder="https://example.com/coa-report.pdf"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        error={linkError}
        hint="Paste a link to a hosted PDF or external lab portal. Customers can click through to view."
      />
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  bulk: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.md, flexWrap: "wrap" },
  leading: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
