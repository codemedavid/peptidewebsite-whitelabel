import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { ChoicePills, EditorSheet, Hint } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText } from "@/ui/primitives";
import {
  GROUP_BUY_SETTINGS_DEFAULTS,
  isoToLocal,
  localToIso,
  statusLabel,
  type GroupBuy,
  type GroupBuyCapabilities,
  type GroupBuySettings,
  type GroupBuyStatus,
} from "./model";

const DAY_MS = 86_400_000;
const DATE_HINT = "YYYY-MM-DD HH:MM, e.g. 2026-10-15 18:00";

/** Non-negative whole number from a text box; "" (cleared) reads as 0 = "not set". */
const whole = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

/** The form's starting values: the round being edited, or the operator's defaults for a new one. */
function seedRound(initial: GroupBuy | null, settings: GroupBuySettings, scheduledEnabled: boolean) {
  if (initial) return initial;
  const startsAt = settings.defaultStatus === "draft" ? null : new Date().toISOString();
  const endsAt = startsAt ? new Date(Date.now() + settings.defaultDurationDays * DAY_MS).toISOString() : null;
  const status: GroupBuyStatus = settings.defaultStatus === "scheduled" && !scheduledEnabled ? "draft" : settings.defaultStatus;
  return {
    name: "",
    description: "",
    status,
    startsAt,
    endsAt,
    deliveryEta: settings.defaultDeliveryEta,
    productIds: [] as string[],
    excludedVariations: {} as Record<string, string[]>,
    slotGoal: 0,
    batchNumber: "",
    orderPrefix: "",
    minVials: null as number | null,
    maxVials: null as number | null,
    moqVials: null as number | null,
  };
}

/**
 * The website's New / Edit Group Buy modal (AdminGroupBuys GroupBuyModal →
 * saveGroupBuyAction). A new round prefills from the operator's defaults; the
 * server re-normalizes and enforces the one-active-round rule on save.
 */
export function RoundEditor({
  initial,
  caps,
  settings,
  products,
  groupBuyOnly,
  saving,
  onCancel,
  onSave,
}: {
  initial: GroupBuy | null;
  caps: GroupBuyCapabilities;
  settings: GroupBuySettings;
  /** `options` = the product's variation names, for the per-round option exclusions. */
  products: { id: string; name: string; options?: string[] }[];
  /** On-hand hidden (website isGroupBuyOnlyStore) — only these stores get Order IDs. */
  groupBuyOnly: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: Partial<GroupBuy>) => void;
}) {
  const t = useTheme();
  const isNew = !initial;
  // Built once per open — a new round's window starts "now".
  const [seed] = useState(() => seedRound(initial, settings, caps.scheduled));

  const start = {
    name: seed.name,
    description: seed.description,
    status: seed.status,
    startsAt: isoToLocal(seed.startsAt),
    endsAt: isoToLocal(seed.endsAt),
    deliveryEta: seed.deliveryEta,
    productIds: seed.productIds,
    slotGoal: seed.slotGoal ? String(seed.slotGoal) : "",
    batchNumber: seed.batchNumber ?? "",
    orderPrefix: seed.orderPrefix ?? "",
    minVials: seed.minVials ? String(seed.minVials) : "",
    maxVials: seed.maxVials ? String(seed.maxVials) : "",
    moqVials: seed.moqVials ? String(seed.moqVials) : "",
  };
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [status, setStatus] = useState<GroupBuyStatus>(start.status);
  const [startsAt, setStartsAt] = useState(start.startsAt);
  const [endsAt, setEndsAt] = useState(start.endsAt);
  const [deliveryEta, setDeliveryEta] = useState(start.deliveryEta);
  const [productIds, setProductIds] = useState<string[]>(start.productIds);
  const [slotGoal, setSlotGoal] = useState(start.slotGoal);
  const [batchNumber, setBatchNumber] = useState(start.batchNumber);
  const [orderPrefix, setOrderPrefix] = useState(start.orderPrefix);
  const [minVials, setMinVials] = useState(start.minVials);
  const [maxVials, setMaxVials] = useState(start.maxVials);
  const [moqVials, setMoqVials] = useState(start.moqVials);
  const [productQuery, setProductQuery] = useState("");
  // Options left OUT of this round, per product ("50mg isn't in this GB").
  const [excluded, setExcluded] = useState<Record<string, string[]>>(() => seed.excludedVariations ?? {});
  const [openOptions, setOpenOptions] = useState<string | null>(null);

  // Only the statuses the web offers; an existing cancelled/archived round keeps its own.
  const baseOptions: GroupBuyStatus[] = caps.scheduled ? ["draft", "scheduled", "active", "closed"] : ["draft", "active", "closed"];
  const statusOptions = baseOptions.includes(status) ? baseOptions : [...baseOptions, status];

  const startsIso = localToIso(startsAt);
  const endsIso = localToIso(endsAt);
  const goal = whole(slotGoal);
  const min = whole(minVials);
  const max = whole(maxVials);
  const moq = whole(moqVials);
  // Group-buy-only stores edit MOQ instead of min/max (the website hides those there).
  const rangeError = !groupBuyOnly && min > 0 && max > 0 && min > max ? "The minimum can't be higher than the maximum." : null;
  // Same rule as the website (lib/orders/order-number-format): A–Z/0–9, 2–16.
  const cleanPrefix = orderPrefix.toUpperCase().replace(/[\s-]+/g, "");
  const prefixError = cleanPrefix && !/^[A-Z0-9]{2,16}$/.test(cleanPrefix) ? "Order ID must be 2–16 letters or numbers, e.g. MNMGB123." : null;
  const canSave = !!name.trim() && startsIso !== undefined && endsIso !== undefined && !rangeError && !prefixError;
  const dirty =
    name !== start.name ||
    description !== start.description ||
    status !== start.status ||
    startsAt !== start.startsAt ||
    endsAt !== start.endsAt ||
    deliveryEta !== start.deliveryEta ||
    productIds.join() !== start.productIds.join() ||
    slotGoal !== start.slotGoal ||
    batchNumber !== start.batchNumber ||
    orderPrefix !== start.orderPrefix ||
    minVials !== start.minVials ||
    maxVials !== start.maxVials ||
    moqVials !== start.moqVials ||
    exclusionsKey(excluded) !== exclusionsKey(seed.excludedVariations ?? {});

  const toggleProduct = (id: string) => {
    const removing = productIds.includes(id);
    setProductIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    // A product taken out of the round takes its option choices with it.
    if (removing) setExcluded(({ [id]: _drop, ...rest }) => rest);
  };
  const toggleOption = (productId: string, option: string) =>
    setExcluded((cur) => {
      const off = cur[productId] ?? [];
      const next = off.includes(option) ? off.filter((n) => n !== option) : [...off, option];
      const { [productId]: _drop, ...rest } = cur;
      return next.length ? { ...rest, [productId]: next } : rest;
    });
  // Only products this round covers keep exclusions (all, when none are picked) — AdminGroupBuys GroupBuyModal.
  const roundExcluded = Object.fromEntries(
    Object.entries(excluded).filter(([id]) => productIds.length === 0 || productIds.includes(id)),
  );
  const q = productQuery.trim().toLowerCase();
  const shownProducts = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;

  return (
    <EditorSheet
      visible
      title={isNew ? "New Group Buy" : "Edit Group Buy"}
      saveLabel="Save"
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() =>
        onSave({
          id: initial?.id ?? "",
          name,
          description,
          status,
          startsAt: startsIso ?? null,
          endsAt: endsIso ?? null,
          deliveryEta,
          productIds,
          // The plan can't assign products → leave it out; the server keeps (or clears) the stored value.
          ...(caps.productAssignment ? { excludedVariations: roundExcluded } : {}),
          slotGoal: goal,
          batchNumber,
          orderPrefix: cleanPrefix,
          // 0 means "cleared" — null stores "not configured" rather than a real 0.
          minVials: min || null,
          maxVials: max || null,
          // Always sent: the server stores what it's given, so leaving it out
          // cleared a group-buy-only round's MOQ on every app edit.
          moqVials: moq || null,
        })
      }
    >
      <Field label="Name *" value={name} onChangeText={setName} placeholder="e.g., June Group Buy" />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Optional note shown only to you"
        multiline
      />
      <View style={{ gap: 6 }}>
        <ChoicePills
          label="Status"
          options={statusOptions.map((s) => ({ key: s, label: statusLabel(s) }))}
          value={status}
          onChange={setStatus}
        />
        {status === "scheduled" ? <Hint>Goes live automatically once the start date passes.</Hint> : null}
      </View>
      <Field
        label="Starts"
        value={startsAt}
        onChangeText={setStartsAt}
        placeholder="YYYY-MM-DD HH:MM"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={startsIso === undefined ? `Use ${DATE_HINT}.` : null}
        hint={DATE_HINT}
      />
      <Field
        label="Ends"
        value={endsAt}
        onChangeText={setEndsAt}
        placeholder="YYYY-MM-DD HH:MM"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={endsIso === undefined ? `Use ${DATE_HINT}.` : null}
        hint="Orders placed inside the window are attributed to this group buy. Leave blank to close it manually."
      />
      <Field
        label="Delivery ETA"
        value={deliveryEta}
        onChangeText={setDeliveryEta}
        placeholder={GROUP_BUY_SETTINGS_DEFAULTS.defaultDeliveryEta}
      />
      <Field
        label="Slot goal"
        value={slotGoal}
        onChangeText={setSlotGoal}
        keyboardType="number-pad"
        placeholder="Off. Leave blank to hide the progress bar"
        hint={goal > 0 ? `Storefront shows “${goal} slots” with a fill bar as orders come in.` : "Off. No progress bar shows for this group buy."}
      />
      <Field
        label="Batch number"
        value={batchNumber}
        onChangeText={(v) => setBatchNumber(v.slice(0, 64))}
        placeholder={`Blank uses the name, “${name || "this round"}”`}
        autoCapitalize="characters"
        autoCorrect={false}
        hint="Your label for this run, e.g. “TR30-B1”. Shown on the dashboard and in every export."
      />
      {groupBuyOnly ? (
        <Field
          label="Order ID"
          value={orderPrefix}
          onChangeText={(v) => setOrderPrefix(v.toUpperCase().slice(0, 32))}
          placeholder="e.g. MNMGB123 (blank uses your store's order numbers)"
          autoCapitalize="characters"
          autoCorrect={false}
          hint={
            prefixError ??
            (cleanPrefix
              ? `This round's orders are numbered ${cleanPrefix}-0001, ${cleanPrefix}-0002…`
              : "Blank: orders in this round keep your store's usual numbers.")
          }
        />
      ) : null}
      {groupBuyOnly ? (
        <Field
          label="Minimum order (MOQ)"
          value={moqVials}
          onChangeText={setMoqVials}
          keyboardType="number-pad"
          placeholder="No minimum"
          hint="The fewest vials one customer can order in this group buy, across all products. Vials per kit is set on each product."
        />
      ) : (
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <Field
            label="Minimum vials"
            value={minVials}
            onChangeText={setMinVials}
            keyboardType="number-pad"
            placeholder="Not set"
            hint="Needed for the run to be viable."
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Maximum vials"
            value={maxVials}
            onChangeText={setMaxVials}
            keyboardType="number-pad"
            placeholder="Not set"
            hint="Progress and completion % measure against this."
          />
        </View>
      </View>
      )}
      {rangeError ? <Hint tone="danger">{rangeError}</Hint> : null}

      {caps.productAssignment ? (
        <View style={{ gap: SPACE.sm }}>
          <AppText variant="label" color="muted">
            Products
          </AppText>
          <Hint>
            {productIds.length === 0
              ? "No selection, so the group buy covers the whole catalog."
              : `${productIds.length} product${productIds.length === 1 ? "" : "s"} assigned.`}
            {products.some((p) => (p.options ?? []).length > 0)
              ? " Products with sizes show “options”. Untick a size to leave it out of this group buy only."
              : ""}
          </Hint>
          {products.length > 8 ? (
            <Field label="Find a product" value={productQuery} onChangeText={setProductQuery} placeholder="Search products…" autoCorrect={false} />
          ) : null}
          <View style={[styles.productBox, { borderColor: t.colors.border }]}>
            {shownProducts.map((p) => {
              const checked = productIds.includes(p.id);
              const options = p.options ?? [];
              const off = excluded[p.id] ?? [];
              const inRound = productIds.length === 0 || checked;
              const open = openOptions === p.id && inRound;
              const onCount = options.filter((n) => !off.includes(n)).length;
              return (
                <View key={p.id}>
                  <View style={styles.productLine}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={p.name}
                      onPress={() => toggleProduct(p.id)}
                      style={[styles.productRow, { flex: 1 }]}
                    >
                      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? t.brand.link : t.colors.textMuted} />
                      <AppText variant="body" style={{ flex: 1 }}>
                        {p.name}
                      </AppText>
                    </Pressable>
                    {options.length > 0 && inRound ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={`${p.name}: ${onCount} of ${options.length} options in this group buy`}
                        onPress={() => setOpenOptions(open ? null : p.id)}
                        hitSlop={6}
                        style={[styles.optionsBtn, { borderColor: t.colors.border }]}
                      >
                        <AppText variant="caption" color={onCount < options.length ? "link" : "muted"}>
                          {`${onCount} of ${options.length} options`}
                        </AppText>
                        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color={t.colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                  {open ? (
                    <View
                      accessibilityLabel={`${p.name} options in this group buy`}
                      style={[styles.optionList, { borderLeftColor: t.brand.link }]}
                    >
                      {options.map((option) => {
                        const on = !off.includes(option);
                        // Keep at least one option — dropping the whole product is the checkbox above.
                        const last = on && onCount === 1;
                        return (
                          <Pressable
                            key={option}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on, disabled: last }}
                            accessibilityLabel={option}
                            accessibilityHint={last ? "Keep at least one option. Untick the product to leave it out" : undefined}
                            disabled={last}
                            onPress={() => toggleOption(p.id, option)}
                            style={[styles.productRow, { opacity: last ? 0.6 : 1 }]}
                          >
                            <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? t.brand.link : t.colors.textMuted} />
                            <AppText
                              variant="body"
                              color={on ? "text" : "muted"}
                              style={[{ flex: 1 }, on ? null : { textDecorationLine: "line-through" }]}
                            >
                              {option}
                            </AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
            {products.length === 0 ? <Hint>No products yet.</Hint> : shownProducts.length === 0 ? <Hint>No products match.</Hint> : null}
          </View>
        </View>
      ) : null}
    </EditorSheet>
  );
}

/** Order-insensitive fingerprint of an exclusions map, for the dirty check. */
const exclusionsKey = (m: Record<string, string[]>): string =>
  Object.keys(m)
    .sort()
    .map((id) => `${id}:${[...m[id]].sort().join("|")}`)
    .join(";");

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: SPACE.md },
  productLine: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  optionsBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.pill, borderWidth: 1 },
  optionList: { marginLeft: 30, marginBottom: SPACE.xs, paddingLeft: SPACE.md, borderLeftWidth: 2 },
  productBox: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs },
  productRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 44 },
});
