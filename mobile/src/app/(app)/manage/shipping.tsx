import { useState } from "react";
import { Stack } from "expo-router";
import { listFrom, removeRows, toggleActive, upsertRow, useCollection } from "@/features/admin/setup/data";
import { currencyOf, newId, str, type Row } from "@/features/admin/setup/rules";
import { SEED_COURIERS, SEED_SHIPPING_LOCATIONS } from "@/features/admin/setup/seeds";
import { ChoicePills, EditorSheet, Hint, ItemCard, ListPage, Loadable, ToggleRow, confirmDelete } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { Pill } from "@/ui/primitives";

/**
 * The website's Shipping Locations (AdminShippingLocations →
 * saveShippingLocationsAction). Each location belongs to one courier and may
 * carry a fee; a blank fee means "no per-location fee" (not ₱0). Every change
 * saves the whole list.
 */
export default function ShippingScreen() {
  const list = useCollection("shippingLocations", "saveShippingLocationsAction", SEED_SHIPPING_LOCATIONS, "shipping locations");
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);

  return (
    <>
      <Stack.Screen options={{ title: "Shipping locations" }} />
      <Loadable query={list.brand}>
        {(brand) => {
          const couriers = listFrom(brand, "couriers", SEED_COURIERS);
          const currency = currencyOf(brand);
          const courierName = (id: unknown) =>
            str(couriers.find((c) => c.id === id)?.name) || (id ? "Unknown courier" : "No courier");
          const startAdd = () => {
            const active = couriers.filter((c) => c.active === true);
            setEditing({
              row: {
                id: newId("s"),
                // Pre-select the only courier when there's exactly one; otherwise force a pick.
                courierId: active.length === 1 ? str(active[0].id) : "",
                code: "",
                name: "",
                active: true,
              },
              isNew: true,
            });
          };
          return (
            <>
              <ListPage
                intro="Where you deliver and what it costs. At checkout customers pick a courier first, then only that courier's locations are offered."
                addLabel="Add location"
                onAdd={startAdd}
                isEmpty={list.items.length === 0}
                empty={{ icon: "location-outline", title: "No shipping locations yet.", action: "Add your first location" }}
                refreshing={list.brand.isRefetching}
                onRefresh={() => void list.brand.refetch()}
              >
                {list.items.map((l) => {
                  const price = typeof l.price === "number" ? l.price : 0;
                  return (
                    <ItemCard
                      key={str(l.id)}
                      title={str(l.name)}
                      lines={[str(l.code) || "—", courierName(l.courierId)]}
                      // No per-location fee → a neutral dash, not "Free".
                      badges={<Pill tone="neutral" size="sm" label={price ? `${currency}${price.toLocaleString()}` : "—"} />}
                      active={l.active === true}
                      disabled={list.saving}
                      onToggle={() => void list.apply(toggleActive(l.id))}
                      onEdit={() => setEditing({ row: l, isNew: false })}
                      onDelete={() =>
                        confirmDelete("Delete this shipping location?", () => void list.apply(removeRows(new Set([l.id]))))
                      }
                    />
                  );
                })}
              </ListPage>
              {editing ? (
                <LocationEditor
                  key={str(editing.row.id)}
                  initial={editing.row}
                  isNew={editing.isNew}
                  couriers={couriers}
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

function LocationEditor({
  initial,
  isNew,
  couriers,
  currency,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  couriers: Row[];
  currency: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const initialPrice = typeof initial.price === "number" ? String(initial.price) : "";
  const [courierId, setCourierId] = useState(str(initial.courierId));
  const [code, setCode] = useState(str(initial.code));
  const [name, setName] = useState(str(initial.name));
  // Raw text so a blank field stays blank (= no fee) rather than snapping to 0.
  const [price, setPrice] = useState(initialPrice);
  const [active, setActive] = useState(initial.active !== false);

  // A saved courier that was since disabled or deleted stays selectable, so
  // editing the row never silently re-assigns it.
  const selectable = couriers.filter((c) => c.active === true);
  const orphaned = !!courierId && !couriers.some((c) => c.id === courierId);
  const options = [
    ...(orphaned ? [{ key: courierId, label: `(unavailable) ${courierId}` }] : []),
    ...selectable.map((c) => ({ key: str(c.id), label: str(c.name) })),
  ];

  const canSave = !!courierId.trim() && !!name.trim() && !!code.trim();
  const dirty =
    courierId !== str(initial.courierId) ||
    code !== str(initial.code) ||
    name !== str(initial.name) ||
    price !== initialPrice ||
    active !== (initial.active !== false);

  function save() {
    const trimmed = price.trim();
    const parsed = Number(trimmed);
    const hasPrice = trimmed !== "" && Number.isFinite(parsed);
    // `price: undefined` drops the key on the wire, like the web's omitted fee.
    onSave({ ...initial, courierId, code, name, price: hasPrice ? Math.max(0, parsed) : undefined, active });
  }

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Shipping Location" : "Edit Shipping Location"}
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={save}
    >
      {options.length ? (
        <ChoicePills label="Courier *" options={options} value={courierId} onChange={setCourierId} />
      ) : (
        <Hint tone="warning">No couriers yet — add one first.</Hint>
      )}
      <Hint>{"Which courier this location's fee applies to. Customers pick the courier first, then only its locations are shown."}</Hint>
      <Field
        label="Code *"
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase().replace(/\s+/g, "_"))}
        placeholder="e.g., NCR, LBC_METRO_MANILA"
        hint="Short uppercase identifier. Used internally for shipping rules."
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Field label="Name *" value={name} onChangeText={setName} placeholder="e.g., LBC - Metro Manila" />
      <Field
        label={`Shipping Fee (${currency})`}
        value={price}
        onChangeText={setPrice}
        placeholder="Leave blank for no fee"
        keyboardType="decimal-pad"
        hint="Leave this blank to charge no fee for this location — useful when you charge a single flat shipping fee elsewhere instead of per-location rates."
      />
      <ToggleRow label="Active" hint="Customers can select this location at checkout." value={active} onChange={setActive} />
    </EditorSheet>
  );
}
