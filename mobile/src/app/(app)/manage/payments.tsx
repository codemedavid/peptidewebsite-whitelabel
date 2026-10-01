import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { removeRows, toggleActive, useCollection, type ListOp } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { QRPH_FEE_PERCENT, newId, str, type Row } from "@/features/admin/setup/rules";
import { SEED_PAYMENT_METHODS } from "@/features/admin/setup/seeds";
import { EditorSheet, ItemCard, ListPage, Loadable, ToggleRow, confirmDelete } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { Pill } from "@/ui/primitives";

/**
 * The website's Payment Methods (AdminPaymentMethods → savePaymentMethodsAction).
 * Like the web, every add / edit / toggle / delete saves the whole list at once.
 * The QR PH tag is only offered when the store is entitled to the QR PH fee —
 * but a tag already saved is never cleared while the feature is off.
 */
export default function PaymentsScreen() {
  const list = useCollection("paymentMethods", "savePaymentMethodsAction", SEED_PAYMENT_METHODS, "payment methods");
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);

  return (
    <>
      <Stack.Screen options={{ title: "Payment methods" }} />
      <Loadable query={list.brand}>
        {(brand) => {
          // Default-OFF feature: anything but a literal true is "not entitled".
          const qrphEntitled = brand.qrphFeeEntitled === true;
          const startAdd = () =>
            setEditing({
              row: { id: newId("pm"), name: "", number: "", account: "", qrImage: "", order: list.items.length + 1, active: true },
              isNew: true,
            });
          return (
            <>
              <ListPage
                intro="How customers pay you. Active methods are offered at checkout with the account details and QR code you add here."
                addLabel="Add payment method"
                onAdd={startAdd}
                isEmpty={list.items.length === 0}
                empty={{ icon: "card-outline", title: "No payment methods yet.", action: "Add your first method" }}
                refreshing={list.brand.isRefetching}
                onRefresh={() => void list.brand.refetch()}
              >
                {list.items.map((m) => (
                  <ItemCard
                    key={str(m.id)}
                    title={str(m.name) || "Untitled"}
                    leading={<QrThumb uri={str(m.qrImage)} />}
                    lines={[str(m.number), `Account: ${str(m.account) || "—"}`, `ID: ${str(m.id)} · Order: #${String(m.order ?? "")}`]}
                    badges={
                      qrphEntitled && m.qrph === true ? (
                        <Pill tone="info" size="sm" icon="qr-code-outline" label={`QR PH · ${QRPH_FEE_PERCENT}%`} />
                      ) : null
                    }
                    active={m.active === true}
                    disabled={list.saving}
                    onToggle={() => void list.apply(toggleActive(m.id))}
                    onEdit={() => setEditing({ row: m, isNew: false })}
                    onDelete={() =>
                      confirmDelete("Delete this payment method?", () => void list.apply(removeRows(new Set([m.id]))))
                    }
                  />
                ))}
              </ListPage>
              {editing ? (
                <MethodEditor
                  key={str(editing.row.id)}
                  initial={editing.row}
                  isNew={editing.isNew}
                  qrphEntitled={qrphEntitled}
                  saving={list.saving}
                  onCancel={() => setEditing(null)}
                  onSave={async (row) => {
                    if (await list.apply(saveMethod(row))) setEditing(null);
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

/** Replace the edited method on the server's current list, or append a new one at the end. */
const saveMethod =
  (row: Row): ListOp =>
  (list) =>
    list.some((r) => r.id === row.id)
      ? list.map((r) => (r.id === row.id ? { ...r, ...row } : r))
      : [...list, { ...row, order: list.length + 1 }];

function QrThumb({ uri }: { uri: string }) {
  const t = useTheme();
  return (
    <View style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <Ionicons name="card-outline" size={22} color={t.colors.textMuted} />
      )}
    </View>
  );
}

function MethodEditor({
  initial,
  isNew,
  qrphEntitled,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  qrphEntitled: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const [name, setName] = useState(str(initial.name));
  const [number, setNumber] = useState(str(initial.number));
  const [account, setAccount] = useState(str(initial.account));
  const [qrImage, setQrImage] = useState(str(initial.qrImage));
  const [qrph, setQrph] = useState(initial.qrph === true);

  const canSave = !!name.trim() && !!number.trim() && !!account.trim();
  const dirty =
    name !== str(initial.name) ||
    number !== str(initial.number) ||
    account !== str(initial.account) ||
    qrImage !== str(initial.qrImage) ||
    qrph !== (initial.qrph === true);

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Payment Method" : "Edit Payment Method"}
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      // Every other key on the row (id, order, active, anything newer) rides through.
      onSave={() => onSave({ ...initial, name, number, account, qrImage, qrph })}
    >
      <Field label="Payment Method Name *" value={name} onChangeText={setName} placeholder="e.g., GCash, Maya, Bank Transfer" />
      <Field
        label="Account Number/Phone *"
        value={number}
        onChangeText={setNumber}
        placeholder="09XX XXX XXXX or Account: 1234-5678-9012"
      />
      <Field label="Account Name *" value={account} onChangeText={setAccount} placeholder="ACCOUNT NAME" autoCapitalize="characters" />
      {qrphEntitled ? (
        <ToggleRow
          label="QR PH account"
          hint={`Tag this if it's your QR PH account. QR PH charges you a percentage on what it collects, so a ${QRPH_FEE_PERCENT}% processing fee is added to the customer's total when they pay this way — shown as its own line before they place the order. Your other payment methods are never charged.`}
          value={qrph}
          onChange={setQrph}
        />
      ) : null}
      <ImageField
        label="QR Code Image (Optional)"
        hint="Upload a QR code image or paste an image URL. If upload fails, you can use the URL field below."
        value={qrImage}
        onChange={setQrImage}
      />
      <Field
        label="Or enter image URL"
        value={qrImage.startsWith("data:") ? "" : qrImage}
        onChangeText={setQrImage}
        placeholder="https://example.com/image.jpg"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACE.xs,
  },
});
