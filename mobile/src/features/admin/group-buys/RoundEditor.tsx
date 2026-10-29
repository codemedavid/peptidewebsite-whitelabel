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
    slotGoal: 0,
    batchNumber: "",
    orderPrefix: "",
    minVials: null as number | null,
    maxVials: null as number | null,
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
  products: { id: string; name: string }[];
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
  const [productQuery, setProductQuery] = useState("");

  // Only the statuses the web offers; an existing cancelled/archived round keeps its own.
  const baseOptions: GroupBuyStatus[] = caps.scheduled ? ["draft", "scheduled", "active", "closed"] : ["draft", "active", "closed"];
  const statusOptions = baseOptions.includes(status) ? baseOptions : [...baseOptions, status];

  const startsIso = localToIso(startsAt);
  const endsIso = localToIso(endsAt);
  const goal = whole(slotGoal);
  const min = whole(minVials);
  const max = whole(maxVials);
  const rangeError = min > 0 && max > 0 && min > max ? "The minimum can't be higher than the maximum." : null;
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
    maxVials !== start.maxVials;

  const toggleProduct = (id: string) => setProductIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
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
          slotGoal: goal,
          batchNumber,
          orderPrefix: cleanPrefix,
          // 0 means "cleared" — null stores "not configured" rather than a real 0.
          minVials: min || null,
          maxVials: max || null,
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
        placeholder="Off — leave blank to hide the progress bar"
        hint={goal > 0 ? `Storefront shows “${goal} slots” with a fill bar as orders come in.` : "Off — no progress bar shows for this group buy."}
      />
      <Field
        label="Batch number"
        value={batchNumber}
        onChangeText={(v) => setBatchNumber(v.slice(0, 64))}
        placeholder={`Blank uses the name — “${name || "this round"}”`}
        autoCapitalize="characters"
        autoCorrect={false}
        hint="Your label for this run, e.g. “TR30-B1”. Shown on the dashboard and in every export."
      />
      {groupBuyOnly ? (
        <Field
          label="Order ID"
          value={orderPrefix}
          onChangeText={(v) => setOrderPrefix(v.toUpperCase().slice(0, 32))}
          placeholder="e.g. MNMGB123 — blank uses your store's order numbers"
          autoCapitalize="characters"
          autoCorrect={false}
          hint={
            prefixError ??
            (cleanPrefix
              ? `This round's orders are numbered ${cleanPrefix}-0001, ${cleanPrefix}-0002…`
              : "Blank — orders in this round keep your store's usual numbers.")
          }
        />
      ) : null}
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
      {rangeError ? <Hint tone="danger">{rangeError}</Hint> : null}

      {caps.productAssignment ? (
        <View style={{ gap: SPACE.sm }}>
          <AppText variant="label" color="muted">
            Products
          </AppText>
          <Hint>
            {productIds.length === 0
              ? "No selection — the group buy covers the whole catalog."
              : `${productIds.length} product${productIds.length === 1 ? "" : "s"} assigned.`}
          </Hint>
          {products.length > 8 ? (
            <Field label="Find a product" value={productQuery} onChangeText={setProductQuery} placeholder="Search products…" autoCorrect={false} />
          ) : null}
          <View style={[styles.productBox, { borderColor: t.colors.border }]}>
            {shownProducts.map((p) => {
              const checked = productIds.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={p.name}
                  onPress={() => toggleProduct(p.id)}
                  style={styles.productRow}
                >
                  <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? t.brand.link : t.colors.textMuted} />
                  <AppText variant="body" style={{ flex: 1 }}>
                    {p.name}
                  </AppText>
                </Pressable>
              );
            })}
            {products.length === 0 ? <Hint>No products yet.</Hint> : shownProducts.length === 0 ? <Hint>No products match.</Hint> : null}
          </View>
        </View>
      ) : null}
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: SPACE.md },
  productBox: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs },
  productRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 44 },
});
