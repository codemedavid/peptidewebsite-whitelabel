import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { removeRows, upsertRow, useCollection } from "@/features/admin/setup/data";
import { currencyOf, isIsoDate, isPromoExpired, newId, str, type Row } from "@/features/admin/setup/rules";
import { SEED_PROMO_CODES } from "@/features/admin/setup/seeds";
import { ChoicePills, EditorSheet, ItemCard, ListPage, Loadable, confirmDelete } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

type PromoType = "fixed" | "percent";

/**
 * The website's Promo Codes (AdminPromoCodes → savePromoCodesAction): search,
 * multi-select delete, and a create/edit form. Every change saves the whole
 * list; checkout re-derives each discount from this same stored set.
 */
export default function PromoScreen() {
  const list = useCollection("promoCodes", "savePromoCodesAction", SEED_PROMO_CODES, "promo codes");
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<unknown>>(new Set());

  return (
    <>
      <Stack.Screen options={{ title: "Promo codes" }} />
      <Loadable query={list.brand}>
        {(brand) => {
          const currency = currencyOf(brand);
          const q = query.trim().toLowerCase();
          const filtered = list.items.filter((c) => !q || str(c.code).toLowerCase().includes(q));
          const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
          const startAdd = () =>
            setEditing({
              row: {
                id: newId("pc"),
                code: "",
                type: "fixed",
                value: 0,
                minPurchase: 0,
                usageLimit: null,
                used: 0,
                expiry: null,
                active: true,
              },
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
            confirmDelete(`Delete ${selected.size} promo code(s)?`, async () => {
              if (await list.apply(removeRows(selected))) setSelected(new Set());
            });

          return (
            <>
              <ListPage
                intro="Discount codes customers can enter at checkout."
                addLabel="Create new code"
                onAdd={startAdd}
                isEmpty={filtered.length === 0}
                empty={
                  q
                    ? { icon: "search-outline", title: "No codes match your search." }
                    : { icon: "pricetag-outline", title: "No promo codes yet.", action: "Create your first code" }
                }
                refreshing={list.brand.isRefetching}
                onRefresh={() => void list.brand.refetch()}
                toolbar={
                  <View style={{ gap: SPACE.md }}>
                    <Field
                      label="Search"
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search by code…"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    <View style={styles.bulk}>
                      <Checkbox
                        checked={allSelected}
                        label={`Select All (${filtered.length})`}
                        onPress={() => setSelected(allSelected ? new Set() : new Set(filtered.map((c) => c.id)))}
                      />
                      <Button
                        label={`Delete Selected${selected.size ? ` (${selected.size})` : ""}`}
                        variant="danger"
                        icon="trash-outline"
                        disabled={!selected.size || list.saving}
                        onPress={deleteSelected}
                      />
                    </View>
                  </View>
                }
              >
                {filtered.map((c) => (
                  <PromoCard
                    key={str(c.id)}
                    promo={c}
                    currency={currency}
                    selected={selected.has(c.id)}
                    disabled={list.saving}
                    onSelect={() => toggle(c.id)}
                    onEdit={() => setEditing({ row: c, isNew: false })}
                    onDelete={() =>
                      confirmDelete("Delete this promo code?", async () => {
                        if (await list.apply(removeRows(new Set([c.id])))) {
                          setSelected((prev) => new Set([...prev].filter((id) => id !== c.id)));
                        }
                      })
                    }
                  />
                ))}
              </ListPage>
              {editing ? (
                <PromoEditor
                  key={str(editing.row.id)}
                  initial={editing.row}
                  isNew={editing.isNew}
                  currency={currency}
                  saving={list.saving}
                  onCancel={() => setEditing(null)}
                  onSave={async (row) => {
                    if (await list.apply(upsertRow(row))) setEditing(null);
                  }}
                />
              ) : null}
            </>
          );
        }}
      </Loadable>
    </>
  );
}

function Checkbox({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={styles.check}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? t.brand.link : t.colors.textMuted} />
      {label ? <AppText variant="label">{label}</AppText> : null}
    </Pressable>
  );
}

function PromoCard({
  promo,
  currency,
  selected,
  disabled,
  onSelect,
  onEdit,
  onDelete,
}: {
  promo: Row;
  currency: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const value = Number(promo.value) || 0;
  const expired = isPromoExpired(promo.expiry);
  const off = promo.active !== true || expired;
  const limit = promo.usageLimit;
  const expiry = str(promo.expiry);
  return (
    <ItemCard
      title={str(promo.code) || "—"}
      leading={<Checkbox checked={selected} label="" onPress={onSelect} />}
      lines={[
        `Usage: ${Number(promo.used) || 0} / ${limit ? String(limit) : "∞"}`,
        `Expiry: ${expiry ? new Date(expiry).toLocaleDateString() : "Never"}`,
      ]}
      badges={
        <>
          <Pill tone="info" size="sm" label={promo.type === "percent" ? `${value}% OFF` : `${currency}${value.toLocaleString()} OFF`} />
          <Pill
            tone={off ? "neutral" : "success"}
            size="sm"
            icon={off ? "close-circle-outline" : "checkmark-circle-outline"}
            label={expired ? "Expired" : promo.active === true ? "Active" : "Inactive"}
          />
        </>
      }
      disabled={disabled}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

function PromoEditor({
  initial,
  isNew,
  currency,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  currency: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const start = {
    code: str(initial.code),
    type: (initial.type === "percent" ? "percent" : "fixed") as PromoType,
    value: String(initial.value ?? 0),
    minP: String(initial.minPurchase ?? 0),
    limit: initial.usageLimit === null || initial.usageLimit === undefined ? "" : String(initial.usageLimit),
    expiry: str(initial.expiry),
  };
  const [code, setCode] = useState(start.code);
  const [type, setType] = useState<PromoType>(start.type);
  const [value, setValue] = useState(start.value);
  const [minP, setMinP] = useState(start.minP);
  const [limit, setLimit] = useState(start.limit);
  const [expiry, setExpiry] = useState(start.expiry);

  // The web's date input can only hold a real YYYY-MM-DD; a typed one must be too.
  const expiryError = expiry.trim() && !isIsoDate(expiry.trim()) ? "Use the format YYYY-MM-DD, e.g. 2026-12-31." : null;
  const canSave = !!code.trim() && Number(value) > 0 && !expiryError;
  const dirty =
    code !== start.code || type !== start.type || value !== start.value || minP !== start.minP || limit !== start.limit || expiry !== start.expiry;

  return (
    <EditorSheet
      visible
      title={isNew ? "Create Promo Code" : "Edit Promo Code"}
      saveLabel={isNew ? "Create Code" : "Save Changes"}
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() =>
        onSave({
          ...initial,
          code,
          type,
          value: Number(value) || 0,
          minPurchase: Number(minP) || 0,
          usageLimit: limit.trim() !== "" ? Number(limit) : null,
          expiry: expiry.trim() || null,
        })
      }
    >
      <Field
        label="Promo Code"
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        placeholder="E.G. SAVE100"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <ChoicePills
        label="Type"
        options={[
          { key: "fixed", label: `Fixed Amount (${currency})` },
          { key: "percent", label: "Percentage (%)" },
        ]}
        value={type}
        onChange={setType}
      />
      <Field label="Value" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
      <Field label={`Min. Purchase (${currency})`} value={minP} onChangeText={setMinP} keyboardType="decimal-pad" />
      <Field label="Usage Limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" placeholder="No limit" />
      <Field
        label="Expiry Date"
        value={expiry}
        onChangeText={setExpiry}
        placeholder="YYYY-MM-DD (blank = never)"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={expiryError}
      />
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  bulk: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.md, flexWrap: "wrap" },
  check: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 40 },
});
