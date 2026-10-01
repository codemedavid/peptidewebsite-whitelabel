import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { listFrom, useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { newId } from "@/features/admin/setup/rules";
import { ChoicePills, FormPage, Hint, Loadable, SaveBar, confirmDelete, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import {
  FAQ_ICONS,
  MAX_FAQ_ANSWER,
  MAX_FAQ_GROUPS,
  MAX_FAQ_ITEMS,
  MAX_FAQ_LABEL,
  MAX_FAQ_QUESTION,
  toFaqGroups,
  type FaqGroup,
  type FaqItem,
} from "@/features/admin/content/rules";
import { SEED_FAQ_GROUPS } from "@/features/admin/content/seeds";
import { EmptyState } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card } from "@/ui/primitives";

/**
 * The website's FAQ editor (AdminFAQManager → saveFaqAction): question groups
 * with a name and icon, each holding question/answer pairs. The web autosaves
 * on every keystroke; on a phone the edits collect here and go up together with
 * Save, as the same whole-list payload.
 */
export default function FaqScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "FAQ" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<FaqGroup[]>(() => toFaqGroups(listFrom(brand, "faqGroups", SEED_FAQ_GROUPS)));
  const [groups, setGroups] = useState<FaqGroup[]>(saved);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveFaqAction");

  const dirty = JSON.stringify(groups) !== JSON.stringify(saved);
  useDiscardGuard(dirty);

  const edit = (next: FaqGroup[]) => {
    hideSaved();
    setGroups(next);
  };
  const updateGroup = (id: string, patch: Partial<FaqGroup>) => edit(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const updateItem = (g: FaqGroup, idx: number, patch: Partial<FaqItem>) =>
    updateGroup(g.id, { items: g.items.map((it, j) => (j === idx ? { ...it, ...patch } : it)) });

  const atGroupCap = groups.length >= MAX_FAQ_GROUPS;
  const addGroup = () =>
    edit([...groups, { id: newId("g"), label: "New Category", icon: "product", items: [{ q: "Sample question?", a: "Sample answer." }] }]);

  function onSave() {
    save.mutate(groups, {
      onSuccess: () => {
        setSaved(groups);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save FAQ", e.message),
    });
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={!dirty} onSave={onSave} />}>
      <AppText variant="body" color="muted">
        Questions shown on your public FAQ page, grouped by topic.
      </AppText>
      <Button label="Add Group" icon="add" disabled={atGroupCap} onPress={addGroup} />
      {atGroupCap ? <Hint tone="warning">{`Up to ${MAX_FAQ_GROUPS} groups.`}</Hint> : null}

      {groups.length === 0 ? (
        <EmptyState icon="help-circle-outline" title="No FAQ groups yet." action={{ label: "Add your first group", onPress: addGroup }} />
      ) : (
        groups.map((g, gi) => (
          <GroupCard
            key={g.id}
            group={g}
            index={gi}
            onChange={(patch) => updateGroup(g.id, patch)}
            onChangeItem={(idx, patch) => updateItem(g, idx, patch)}
            onRemove={() =>
              confirmDelete("Delete this FAQ group and all its questions?", () => edit(groups.filter((x) => x.id !== g.id)))
            }
          />
        ))
      )}
    </FormPage>
  );
}

function GroupCard({
  group,
  index,
  onChange,
  onChangeItem,
  onRemove,
}: {
  group: FaqGroup;
  index: number;
  onChange: (patch: Partial<FaqGroup>) => void;
  onChangeItem: (idx: number, patch: Partial<FaqItem>) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const danger = t.tone("danger").fg;
  const name = group.label.trim() || `Group ${index + 1}`;
  const atItemCap = group.items.length >= MAX_FAQ_ITEMS;
  return (
    <Card style={{ gap: SPACE.lg }}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Field
            label="Group name"
            value={group.label}
            onChangeText={(label) => onChange({ label })}
            placeholder="Group name (e.g. Shipping & Delivery)"
            maxLength={MAX_FAQ_LABEL}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete group ${name}`}
          hitSlop={8}
          onPress={onRemove}
          style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.6 } : null]}
        >
          <Ionicons name="trash-outline" size={20} color={danger} />
        </Pressable>
      </View>
      <ChoicePills
        label="Icon"
        options={FAQ_ICONS}
        value={FAQ_ICONS.some((o) => o.key === group.icon) ? (group.icon as (typeof FAQ_ICONS)[number]["key"]) : "default"}
        onChange={(icon) => onChange({ icon })}
      />

      {group.items.map((item, i) => (
        <View key={i} style={[styles.item, { borderColor: t.colors.border }]}>
          <View style={styles.itemHead}>
            <AppText variant="overline" color="muted">{`QUESTION ${i + 1}`}</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove question ${i + 1} from ${name}`}
              hitSlop={8}
              onPress={() => onChange({ items: group.items.filter((_, j) => j !== i) })}
              style={({ pressed }) => [styles.remove, pressed ? { opacity: 0.6 } : null]}
            >
              <Ionicons name="trash-outline" size={16} color={danger} />
              <AppText variant="label" color={danger}>
                Remove
              </AppText>
            </Pressable>
          </View>
          <Field label="Question" value={item.q} onChangeText={(q) => onChangeItem(i, { q })} placeholder="Question…" maxLength={MAX_FAQ_QUESTION} />
          <Field
            label="Answer"
            value={item.a}
            onChangeText={(a) => onChangeItem(i, { a })}
            placeholder="Answer…"
            multiline
            maxLength={MAX_FAQ_ANSWER}
          />
        </View>
      ))}
      <Button
        label="Add question"
        icon="add"
        variant="secondary"
        disabled={atItemCap}
        onPress={() => onChange({ items: [...group.items, { q: "", a: "" }] })}
      />
      {atItemCap ? <Hint tone="warning">{`Up to ${MAX_FAQ_ITEMS} questions per group.`}</Hint> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  item: { gap: SPACE.md, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  itemHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  remove: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, paddingHorizontal: SPACE.xs },
});
