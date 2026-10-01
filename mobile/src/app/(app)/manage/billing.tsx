import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { accountKeys, callAction, useBillingInfo, useInvoices } from "@/features/admin/account/data";
import {
  BILLING_CYCLE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONE,
  fmtDate,
  fmtPesos,
  isHostedUrl,
  parsePaymentAmountCents,
  paymentMethodOptions,
  subscriptionOf,
  type InvoiceRow,
} from "@/features/admin/account/rules";
import { MoneyLine, Notice, PayChannelRow } from "@/features/admin/account/ui";
import { success, useAdminBrand } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { isIsoDate } from "@/features/admin/setup/rules";
import { ChoicePills, FormPage, Hint, Loadable, Section, useDiscardGuard } from "@/features/admin/setup/ui";
import { useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

/**
 * The website's Billing (AdminBilling), owner only: the subscription due
 * window, the provider's receiving accounts, a proof-of-payment form
 * (screenshot → uploadStorefrontImageAction, then submitSubscriptionPaymentAction
 * files a PENDING payment) and the invoice history with each review status.
 */
export default function BillingScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Billing" }} />
      <Loadable query={brand}>{(b) => <Billing brand={b} />}</Loadable>
    </>
  );
}

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function Billing({ brand }: { brand: AdminBrand }) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const online = useOnline();
  const sub = subscriptionOf(brand);
  const info = useBillingInfo();
  const invoices = useInvoices();
  const methodOptions = paymentMethodOptions((info.data?.channels ?? []).map((c) => c.method));

  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState("");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [done, setDone] = useState(false);

  // Snapped to the provider's first channel until the owner picks, so the
  // submitted method always matches an offered option (as the web does).
  const method = methodOptions.includes(picked) ? picked : methodOptions[0];

  const dirty = !!(amount || reference || paidAt || proofUrl);
  useDiscardGuard(dirty, "The payment you started filing hasn't been submitted.");

  const amountValid = parsePaymentAmountCents(amount) != null;
  const dateError = paidAt.trim() && !isIsoDate(paidAt.trim()) ? "Use the format YYYY-MM-DD, e.g. 2026-09-30." : null;
  const amountDueCents = sub ? sub.amountDueCents : undefined;
  const cycleLabel = sub?.cycle ? BILLING_CYCLE_LABELS[sub.cycle]?.toLowerCase() : null;

  const submit = useMutation({
    mutationFn: () =>
      callAction("submitSubscriptionPaymentAction", {
        amount,
        method,
        reference,
        paidAt: paidAt.trim() || undefined,
        proofUrl: proofUrl || undefined,
      }),
    onSuccess: () => {
      success();
      setDone(true);
      setAmount("");
      setReference("");
      setPaidAt("");
      setProofUrl("");
      void qc.invalidateQueries({ queryKey: accountKeys.invoices(scope) });
      Alert.alert("Payment submitted for review");
    },
    onError: (e) => Alert.alert("Couldn't submit", e.message),
  });

  const canSubmit = amountValid && !dateError && !submit.isPending && online;

  return (
    <FormPage>
      <Section title="Your subscription">
        {sub ? (
          sub.expired ? (
            <Notice tone="danger" icon="alert-circle-outline">
              {`Your subscription ended on ${fmtDate(sub.endsAt)}. Submit your renewal payment below to restore full access.`}
            </Notice>
          ) : (
            <AppText variant="body" color="muted">
              {`Next payment due ${fmtDate(sub.endsAt)}${
                typeof sub.daysLeft === "number" ? ` — ${sub.daysLeft} day${sub.daysLeft === 1 ? "" : "s"} left` : ""
              }. Pay early and file your proof below so your provider can confirm it.`}
            </AppText>
          )
        ) : (
          <AppText variant="body" color="muted">
            No active subscription window is set. You can still file a payment below — your provider will match it to your account.
          </AppText>
        )}
        {typeof amountDueCents === "number" ? (
          <View style={{ gap: 2 }}>
            <MoneyLine label="Amount due" value={fmtPesos(amountDueCents)} strong />
            {cycleLabel ? <Hint>{`Billed ${cycleLabel}`}</Hint> : null}
          </View>
        ) : null}
      </Section>

      {info.data && info.data.channels.length > 0 ? (
        <Section
          title="Payment methods"
          hint={info.data.instructions.trim() || "Pay your provider through any of these accounts, then file your proof below."}
        >
          {info.data.channels.map((ch) => (
            <PayChannelRow key={ch.id} channel={ch} />
          ))}
        </Section>
      ) : null}

      <Section
        title="Submit a payment"
        hint="After you pay, record it here with a screenshot so your provider can confirm it. It stays “awaiting confirmation” until they review it."
      >
        {done ? (
          <Notice tone="success" icon="checkmark-circle-outline">
            {"Payment submitted — awaiting your provider's confirmation. File another below if needed."}
          </Notice>
        ) : null}
        <Field
          label="Amount paid (₱)"
          value={amount}
          onChangeText={(v) => {
            setDone(false);
            setAmount(v);
          }}
          keyboardType="decimal-pad"
          placeholder={typeof amountDueCents === "number" ? String(amountDueCents / 100) : "e.g. 1499"}
          error={amount.trim() && !amountValid ? "Enter a valid amount greater than zero." : null}
          hint="The total you sent for this term."
        />
        <ChoicePills label="Payment method" options={methodOptions.map((m) => ({ key: m, label: m }))} value={method} onChange={setPicked} />
        <Field label="Reference number" value={reference} onChangeText={setReference} placeholder="e.g. 9021 447 6613" maxLength={120} autoCorrect={false} />
        <View style={{ gap: SPACE.sm }}>
          <Field
            label="Date paid"
            value={paidAt}
            onChangeText={setPaidAt}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            error={dateError}
          />
          <View style={styles.row}>
            <Button label="Today" variant="ghost" icon="calendar-outline" onPress={() => setPaidAt(todayIso())} />
          </View>
        </View>
        <ImageField
          label="Payment screenshot"
          hint="A GCash/bank receipt screenshot helps your provider confirm faster. Optional but recommended."
          value={proofUrl}
          onChange={(url) => setProofUrl(url)}
          validate={(url) => (isHostedUrl(url) ? null : "This store can't host images yet, so the screenshot can't be attached.")}
          previewAspect={3 / 4}
        />
        <Button
          label={submit.isPending ? "Submitting…" : "Submit payment"}
          icon="send-outline"
          loading={submit.isPending}
          disabled={!canSubmit}
          onPress={() => submit.mutate()}
        />
      </Section>

      <Section title="Invoice history">
        <InvoiceList query={invoices} />
      </Section>
    </FormPage>
  );
}

function InvoiceList({ query }: { query: { data?: InvoiceRow[]; isPending: boolean; isError: boolean } }) {
  if (query.isPending) return <Hint>Loading your payments…</Hint>;
  const rows = query.isError ? [] : (query.data ?? []);
  if (rows.length === 0) {
    return <Hint>No payments filed yet — payments you submit above will appear here with their confirmation status.</Hint>;
  }
  return (
    <View style={{ gap: SPACE.md }}>
      {rows.map((inv) => (
        <View key={inv.id} style={styles.invoice} accessible accessibilityLabel={`${inv.code}, ${fmtPesos(inv.amountCents)}, ${INVOICE_STATUS_LABELS[inv.status]}`}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{inv.code}</AppText>
            <AppText variant="caption" color="muted">{`${fmtDate(inv.dateIso)} · ${inv.method}`}</AppText>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <AppText variant="bodyStrong">{fmtPesos(inv.amountCents)}</AppText>
            <Pill tone={INVOICE_STATUS_TONE[inv.status] ?? "warning"} size="sm" label={INVOICE_STATUS_LABELS[inv.status] ?? inv.status} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  invoice: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
