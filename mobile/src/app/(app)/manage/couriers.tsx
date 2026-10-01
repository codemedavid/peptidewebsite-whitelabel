import { useState } from "react";
import { Stack } from "expo-router";
import { listFrom, removeRows, toggleActive, upsertRow, useCollection } from "@/features/admin/setup/data";
import { newId, safeExternalUrl, str, type Row } from "@/features/admin/setup/rules";
import { SEED_COURIERS, SEED_SHIPPING_LOCATIONS } from "@/features/admin/setup/seeds";
import { EditorSheet, Hint, ItemCard, ListPage, Loadable, ToggleRow, confirmDelete } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { Pill } from "@/ui/primitives";

/**
 * The website's Couriers (AdminCouriers → saveCouriersAction). Every change
 * saves the whole list. The booking-form link is only offered to stores
 * entitled to courier booking; a link already saved is kept while it's off.
 */
export default function CouriersScreen() {
  const list = useCollection("couriers", "saveCouriersAction", SEED_COURIERS, "couriers");
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);

  return (
    <>
      <Stack.Screen options={{ title: "Couriers" }} />
      <Loadable query={list.brand}>
        {(brand) => {
          const bookingEntitled = brand.courierBookingEntitled === true;
          const locations = listFrom(brand, "shippingLocations", SEED_SHIPPING_LOCATIONS);
          // A location-based courier with no active location is silently dropped
          // from checkout — flag it, as the web does, to explain the mismatch.
          const hasActiveLocation = (id: unknown) => locations.some((l) => l.active === true && l.courierId === id);
          const startAdd = () => setEditing({ row: { id: newId("c"), name: "", trackingUrl: "", active: true }, isNew: true });
          return (
            <>
              <ListPage
                intro="The couriers you ship with. Customers pick a courier at checkout, and you choose one when adding tracking to an order."
                addLabel="Add courier"
                onAdd={startAdd}
                isEmpty={list.items.length === 0}
                empty={{ icon: "bicycle-outline", title: "No couriers yet.", action: "Add your first courier" }}
                refreshing={list.brand.isRefetching}
                onRefresh={() => void list.brand.refetch()}
              >
                {list.items.map((c) => {
                  const booking = bookingEntitled ? str(c.bookingUrl) : "";
                  const noLocationWarning = c.active === true && c.noLocation !== true && !hasActiveLocation(c.id);
                  return (
                    <ItemCard
                      key={str(c.id)}
                      title={str(c.name)}
                      lines={[str(c.trackingUrl), booking ? `Booking form · ${booking}` : null]}
                      badges={
                        c.noLocation === true || noLocationWarning ? (
                          <>
                            {c.noLocation === true ? (
                              <Pill tone="info" size="sm" icon="cash-outline" label="Cash on delivery — no shipping location or fee" />
                            ) : null}
                            {noLocationWarning ? (
                              <Pill tone="warning" size="sm" icon="warning-outline" label="No shipping location — won't show at checkout" />
                            ) : null}
                          </>
                        ) : null
                      }
                      active={c.active === true}
                      disabled={list.saving}
                      onToggle={() => void list.apply(toggleActive(c.id))}
                      onEdit={() => setEditing({ row: c, isNew: false })}
                      onDelete={() => confirmDelete("Delete this courier?", () => void list.apply(removeRows(new Set([c.id]))))}
                    />
                  );
                })}
              </ListPage>
              {editing ? (
                <CourierEditor
                  key={str(editing.row.id)}
                  initial={editing.row}
                  isNew={editing.isNew}
                  bookingEntitled={bookingEntitled}
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

function CourierEditor({
  initial,
  isNew,
  bookingEntitled,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  bookingEntitled: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const [name, setName] = useState(str(initial.name));
  const [trackingUrl, setTrackingUrl] = useState(str(initial.trackingUrl));
  const [bookingUrl, setBookingUrl] = useState(str(initial.bookingUrl));
  const [active, setActive] = useState(initial.active !== false);
  const [noLocation, setNoLocation] = useState(initial.noLocation === true);

  const dirty =
    name !== str(initial.name) ||
    trackingUrl !== str(initial.trackingUrl) ||
    bookingUrl !== str(initial.bookingUrl) ||
    active !== (initial.active !== false) ||
    noLocation !== (initial.noLocation === true);

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Courier" : "Edit Courier"}
      canSave={name.trim().length > 0}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() =>
        onSave({
          ...initial,
          name: name.trim(),
          trackingUrl: trackingUrl.trim(),
          // Not a web link → dropped (the server drops it too).
          bookingUrl: safeExternalUrl(bookingUrl),
          active,
          noLocation,
        })
      }
    >
      <Field label="Name *" value={name} onChangeText={setName} placeholder="e.g., LBC Express" autoCapitalize="words" />
      <Field
        label="Tracking Page URL (Optional)"
        value={trackingUrl}
        onChangeText={setTrackingUrl}
        placeholder="e.g., https://www.lbcexpress.com/track"
        hint="Where customers can look up their tracking number."
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {bookingEntitled ? (
        <>
          <Field
            label="Booking / Delivery Form Link (Optional)"
            value={bookingUrl}
            onChangeText={setBookingUrl}
            placeholder="e.g., https://.../lalamove-form"
            hint="Shown to the customer at checkout when they pick this courier, so they can fill in the delivery form before placing the order. Must start with http:// or https://. Leave blank for no form."
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {bookingUrl.trim() && !safeExternalUrl(bookingUrl) ? (
            <Hint tone="warning">{"That isn't a web link — it won't be saved. Start it with https://"}</Hint>
          ) : null}
        </>
      ) : null}
      <ToggleRow
        label="No shipping location / fee — cash on delivery only"
        hint="For couriers like Lalamove or Maxim where the customer just pays COD. Offered at checkout without a location selector and adds no shipping fee."
        value={noLocation}
        onChange={setNoLocation}
      />
      <ToggleRow label="Active" hint="Selectable when saving tracking info on orders." value={active} onChange={setActive} />
    </EditorSheet>
  );
}
