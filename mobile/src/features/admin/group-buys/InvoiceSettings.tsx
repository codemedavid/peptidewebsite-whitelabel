import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { success } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { EditorSheet, Hint, Section, ToggleRow } from "@/features/admin/setup/ui";
import { money } from "@/features/shop/lib/money";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button, Card } from "@/ui/primitives";
import { useGroupBuySetting } from "./hooks";
import {
  DEFAULT_INVOICE_TEMPLATE,
  GB_INVOICE_LIMITS,
  INVOICE_PLACEHOLDERS,
  buildGroupBuyInvoice,
  normalizeGroupBuyInvoice,
  type GroupBuyInvoiceConfig,
  type InvoiceOrder,
  type InvoicePaymentMethod,
} from "./invoice";

/**
 * Pay-after-close group buys (saveGroupBuyInvoiceAction): the switch, the
 * once-per-round shipping fee, the invoice message the customer gets in chat
 * when a round closes, and the payment options (with QR images) it lists.
 * The preview renders with the server's own invoice builder (invoice.ts is a
 * byte-identical copy, pinned by npm run test:gb-invoice).
 */

type SaveResult = { ok: true; invoice: GroupBuyInvoiceConfig };

export function InvoiceCard({
  value,
  setValue,
  currency,
  onEdit,
  showSwitch = true,
}: {
  value: GroupBuyInvoiceConfig;
  setValue: (v: GroupBuyInvoiceConfig) => void;
  currency: string;
  onEdit: () => void;
  /** Off when the "How customers pay" card owns the on/off choice. */
  showSwitch?: boolean;
}) {
  const save = useGroupBuySetting<SaveResult>("saveGroupBuyInvoiceAction");
  const methods = value.paymentMethods.length;
  return (
    <Section
      title="Invoice after close"
      hint="Customers check out a group buy without paying. When the round closes, each one gets a single invoice in Chats with everything they ordered and how to pay."
    >
      {showSwitch ? (
        <ToggleRow
          label="Pay after the group buy closes"
          value={value.enabled}
          disabled={save.isPending}
          onChange={(enabled) => {
            const prev = value;
            setValue({ ...value, enabled });
            save.mutate({ ...value, enabled }, { onSuccess: (res) => setValue(res.invoice), onError: () => setValue(prev) });
          }}
        />
      ) : null}
      {value.enabled ? (
        <>
          <View style={{ gap: SPACE.xs }}>
            <SummaryLine icon="cube-outline" text={`Shipping ${value.shippingFee > 0 ? money(value.shippingFee, currency) : "free"} — once per customer per round`} />
            <SummaryLine icon="add-circle-outline" text="Ordering again in the same round adds to the same invoice" />
            <SummaryLine
              icon="wallet-outline"
              text={methods === 0 ? "No payment options yet" : `${methods} payment option${methods === 1 ? "" : "s"} on the invoice`}
              warn={methods === 0}
            />
          </View>
          <Button label="Edit invoice & payment options" variant="secondary" icon="create-outline" onPress={onEdit} />
        </>
      ) : (
        <Hint>Customers pay at checkout, as usual.</Hint>
      )}
    </Section>
  );
}

function SummaryLine({ icon, text, warn }: { icon: "cube-outline" | "add-circle-outline" | "wallet-outline"; text: string; warn?: boolean }) {
  const t = useTheme();
  const color = warn ? t.tone("warning").fg : t.colors.textMuted;
  return (
    <View style={styles.summary}>
      <Ionicons name={icon} size={16} color={color} />
      <AppText variant="caption" color={warn ? color : "muted"} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

const SAMPLE_SHIPPING = { address: "12 Mabini St.", barangay: "Ibabang Dupay", city: "Lucena City", province: "Quezon", postal: "4301", fee: 0 };
const SAMPLE_ORDERS: InvoiceOrder[] = [
  {
    id: "sample-1",
    orderNumber: "PEP095",
    placedAt: "2026-10-01T01:00:00Z",
    customer: { name: "Juan Dela Cruz", phone: "09171234567", email: "" },
    shipping: SAMPLE_SHIPPING,
    courier: "J&T Express",
    items: [{ name: "Tirzepatide 30mg (TZ30)", qty: 2, price: 1690 }],
    adminFee: null,
    paymentFee: null,
    discount: null,
  },
  {
    id: "sample-2",
    orderNumber: "PEP101",
    placedAt: "2026-10-01T05:00:00Z",
    customer: { name: "Juan Dela Cruz", phone: "09171234567", email: "" },
    shipping: SAMPLE_SHIPPING,
    courier: "J&T Express",
    items: [{ name: "Retatrutide 30mg (RT30)", qty: 1, price: 1495 }],
    adminFee: null,
    paymentFee: null,
    discount: null,
  },
];

let nextId = 0;
const newMethodId = () => `pm-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

export function InvoiceEditor({
  initial,
  currency,
  roundName,
  onClose,
  onSaved,
}: {
  initial: GroupBuyInvoiceConfig;
  currency: string;
  roundName: string;
  onClose: () => void;
  onSaved: (v: GroupBuyInvoiceConfig) => void;
}) {
  const t = useTheme();
  const save = useGroupBuySetting<SaveResult>("saveGroupBuyInvoiceAction");
  const [fee, setFee] = useState(initial.shippingFee > 0 ? String(initial.shippingFee) : "");
  const [unit, setUnit] = useState(initial.unit);
  const [template, setTemplate] = useState(initial.template || DEFAULT_INVOICE_TEMPLATE);
  const [methods, setMethods] = useState<InvoicePaymentMethod[]>(initial.paymentMethods);

  const draft = normalizeGroupBuyInvoice({ ...initial, shippingFee: fee, unit, template, paymentMethods: methods });
  const dirty = JSON.stringify(draft) !== JSON.stringify(normalizeGroupBuyInvoice(initial));
  const feeError = fee.trim() && !(Number(fee) >= 0) ? "Enter an amount, e.g. 250" : null;

  const preview = useMemo(
    () =>
      buildGroupBuyInvoice({
        orders: SAMPLE_ORDERS.map((o, i) => (i === 0 ? { ...o, shipping: { ...o.shipping, fee: draft.shippingFee } } : o)),
        roundName: roundName || "GB 10/2/2026",
        closedAt: new Date().toISOString(),
        config: draft,
        money: (n) => money(n, currency),
      }),
    // draft is rebuilt every render; its inputs are what change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fee, unit, template, methods, roundName, currency],
  );

  const patchMethod = (id: string, patch: Partial<InvoicePaymentMethod>) =>
    setMethods((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const removeMethod = (m: InvoicePaymentMethod) =>
    Alert.alert(`Remove ${m.name || "this payment option"}?`, "It won't be on future invoices.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setMethods((list) => list.filter((x) => x.id !== m.id)) },
    ]);
  const insert = (key: string) =>
    setTemplate((cur) => `${cur}${cur === "" || cur.endsWith("\n") ? "" : " "}{${key}}`.slice(0, GB_INVOICE_LIMITS.template));

  return (
    <EditorSheet
      visible
      title="Invoice"
      saveLabel="Save invoice"
      canSave={!feeError}
      dirty={dirty}
      saving={save.isPending}
      onCancel={onClose}
      onSave={() => save.mutate(draft, { onSuccess: (res) => onSaved(res.invoice) })}
    >
      <Section title="Shipping">
        <Field
          label={`Shipping fee (${currency})`}
          value={fee}
          onChangeText={setFee}
          keyboardType="decimal-pad"
          placeholder="250"
          error={feeError}
          hint="Charged once per customer per round. Ordering again in the same round adds no shipping."
        />
        <Field
          label="Unit"
          value={unit}
          onChangeText={setUnit}
          maxLength={GB_INVOICE_LIMITS.unit}
          placeholder="vial"
          hint="Shown after each quantity — “2 vials”. Leave blank for just the number."
        />
      </Section>

      <Section title="Payment options" hint="Listed on the invoice. Each photo (a QR code) is sent right after it, so customers can scan and pay.">
        {methods.map((m, i) => (
          <Card key={m.id} style={{ gap: SPACE.md }}>
            <View style={styles.methodHead}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {m.name || `Payment option ${i + 1}`}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${m.name || `payment option ${i + 1}`}`}
                hitSlop={8}
                onPress={() => removeMethod(m)}
              >
                <Ionicons name="trash-outline" size={20} color={t.tone("danger").fg} />
              </Pressable>
            </View>
            <Field label="Name" value={m.name} maxLength={GB_INVOICE_LIMITS.methodName} placeholder="GoTyme" onChangeText={(name) => patchMethod(m.id, { name })} />
            <Field
              label="Account details"
              value={m.details}
              multiline
              maxLength={GB_INVOICE_LIMITS.methodDetails}
              placeholder="016793762828 - Account Name"
              onChangeText={(details) => patchMethod(m.id, { details })}
            />
            <ImageField
              label="QR code or photo (optional)"
              value={m.imageUrl}
              previewAspect={1}
              validate={(url) => (/^https:\/\//.test(url) ? null : "Image hosting isn't set up for this store, so photos can't be sent in chat.")}
              onChange={(imageUrl) => patchMethod(m.id, { imageUrl })}
            />
          </Card>
        ))}
        {methods.length < GB_INVOICE_LIMITS.methods ? (
          <Button
            label="Add payment option"
            variant="secondary"
            icon="add"
            onPress={() => setMethods((list) => [...list, { id: newMethodId(), name: "", details: "", imageUrl: "" }])}
          />
        ) : null}
      </Section>

      <Section title="Message" hint="Tap a field to add it at the end. A line whose fields all come out empty is left out.">
        <View style={styles.chips}>
          {INVOICE_PLACEHOLDERS.map((p) => (
            <Pressable
              key={p.key}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${p.label}`}
              onPress={() => insert(p.key)}
              style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? t.colors.border : t.colors.surfaceAlt, borderColor: t.colors.border }]}
            >
              <AppText variant="caption">{p.label}</AppText>
            </Pressable>
          ))}
        </View>
        <Field label="Invoice message" value={template} multiline maxLength={GB_INVOICE_LIMITS.template} onChangeText={setTemplate} />
        {template !== DEFAULT_INVOICE_TEMPLATE ? (
          <Button label="Reset to the default message" variant="ghost" icon="refresh" onPress={() => setTemplate(DEFAULT_INVOICE_TEMPLATE)} />
        ) : null}
      </Section>

      <Section title="Preview" hint="A sample customer with two orders in one round — one shipping fee.">
        <View style={[styles.bubble, { backgroundColor: t.colors.surfaceAlt, borderLeftColor: t.brand.primary }]}>
          <AppText variant="caption" color="muted" style={styles.bubbleHead}>
            ORDER UPDATES · BOT
          </AppText>
          <AppText variant="body" selectable>
            {preview?.text ?? ""}
          </AppText>
        </View>
        {preview && preview.images.length > 0 ? (
          <View style={styles.thumbs}>
            {preview.images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={[styles.thumb, { borderColor: t.colors.border }]}
                contentFit="cover"
                accessibilityLabel="Payment image sent with the invoice"
              />
            ))}
          </View>
        ) : null}
      </Section>
    </EditorSheet>
  );
}

// ── Send invoices (closed round) ─────────────────────────────────────────────

type SendResult = { ok: true; sent: number; unchanged: number; guests: number; skipped: number };

function sentMessage(r: SendResult): string {
  const parts = [
    r.sent > 0 ? `${r.sent} invoice${r.sent === 1 ? "" : "s"} sent in Chats.` : "No new invoices to send.",
    r.unchanged > 0 ? `${r.unchanged} customer${r.unchanged === 1 ? " already has" : "s already have"} an up-to-date invoice.` : "",
    r.guests > 0 ? `${r.guests} guest order${r.guests === 1 ? "" : "s"} can't get one — no app account to message.` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** The owner's "Send invoices" button: sends now, re-sends only what changed. */
export function useSendInvoices() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await adminBridge.call<SendResult | { error: string }>("sendGroupBuyInvoicesAction", id)) as SendResult,
    onSuccess: (r) => {
      success();
      Alert.alert("Invoices", sentMessage(r));
      void qc.invalidateQueries({ queryKey: [scope, "admin"] });
    },
    onError: (e) => Alert.alert("Couldn't send invoices", e.message),
  });
}

export function confirmSendInvoices(roundName: string, run: () => void) {
  Alert.alert(
    `Send ${roundName} invoices?`,
    "Every customer who ordered in this round from the app gets their invoice in Chats. Anyone who already has an identical invoice isn't messaged again.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Send", onPress: run },
    ],
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  methodHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.xs },
  chip: { paddingHorizontal: SPACE.md, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  bubble: { padding: SPACE.md, borderRadius: RADIUS.lg, borderLeftWidth: 4, gap: SPACE.xs },
  bubbleHead: { letterSpacing: 0.3 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  thumb: { width: 88, height: 88, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth },
});
