import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { openLink } from "@/features/community/open";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, Button, Pill } from "@/ui/primitives";
import { paidAccessProofUrl } from "./hooks";
import {
  approvalFollowsPayment,
  REFUND_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type PaidAccessDecision,
  type PromptAction,
  type QueueRow,
} from "./model";

/**
 * One member in the Paid Access queue: who, where they are, the payment they sent
 * (with the proof one tap away) and their application answers — then only the
 * decisions their status allows. The server re-checks every one.
 */

type Props = {
  row: QueueRow;
  roundName: string;
  busy: boolean;
  onDecide: (decision: PaidAccessDecision, confirm?: { title: string; body: string; label: string }) => void;
  onPrompt: (action: PromptAction) => void;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");
// Only a refund the store owes by hand; "processing" is the provider's to finish.
const REFUND_OPEN = new Set(["pending"]);
/** Statuses an admin may still turn down before a decision step (core/machine.ts). */
const REJECTABLE_EARLY = new Set(["waitlisted", "form_pending", "payment_pending"]);

export function QueueCard({ row, roundName, busy, onDecide, onPrompt }: Props) {
  const t = useTheme();
  const p = row.payment;
  const refundLabel = REFUND_LABEL[row.refundStatus];
  const facts: [string, string][] = [];
  if (roundName) facts.push(["Round", roundName]);
  if (p) {
    facts.push(["Amount", p.kind === "deposit" ? `${p.amountLabel} (deposit)` : p.amountLabel]);
    facts.push(["Paid via", p.provider === "manual" ? p.method || "Manual transfer" : `Online (${p.provider})`]);
    if (p.reference) facts.push(["Reference", p.reference]);
    if (p.paidAt) facts.push(["Paid on", when(p.paidAt)]);
    if (p.submittedAt) facts.push(["Sent", when(p.submittedAt)]);
  }
  if (row.status === "payment_pending" && row.holdExpiresAt) facts.push(["Slot held until", when(row.holdExpiresAt)]);
  if (row.reviewReason) facts.push(["Reason", row.reviewReason]);
  if (row.refundReference) facts.push(["Refund ref", row.refundReference]);
  facts.push(["Joined", when(row.createdAt)]);

  const checkProof = row.status === "payment_review" && p?.provider === "manual" && p.status === "submitted";
  const name = row.customerName || row.customerEmail || "this member";

  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {row.customerName || "Customer"}
          </AppText>
          <AppText variant="caption" color="muted" numberOfLines={1} selectable>
            {row.customerEmail}
          </AppText>
        </View>
        <View style={styles.pills}>
          <Pill size="sm" tone={STATUS_TONE[row.status] ?? "neutral"} label={STATUS_LABEL[row.status] ?? row.status} />
          {refundLabel ? <Pill size="sm" tone={row.refundStatus === "refunded" ? "success" : "warning"} label={refundLabel} /> : null}
        </View>
      </View>

      <View style={styles.facts}>
        {facts.map(([k, v]) => (
          <View key={k} style={styles.fact}>
            <AppText variant="caption" color="muted">
              {k}
            </AppText>
            <AppText variant="body" style={styles.factValue} selectable>
              {v}
            </AppText>
          </View>
        ))}
      </View>

      {p?.duplicateReference ? (
        <Warning text="This reference number is on another payment too — check the proof carefully." />
      ) : null}

      {row.formAnswers.length > 0 ? (
        <View style={[styles.answers, { borderTopColor: t.colors.border }]}>
          <AppText variant="overline" color="muted">
            APPLICATION
          </AppText>
          {row.formAnswers.map((a, i) => (
            <View key={`${i}-${a.question}`} style={{ gap: 2 }}>
              <AppText variant="caption" color="muted">
                {a.question}
              </AppText>
              <AppText variant="body" selectable>
                {a.answer}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {p?.hasReceipt ? <ProofButton paymentId={p.id} /> : null}
        {checkProof && p ? (
          <>
            <Button label="Reject proof" variant="secondary" disabled={busy} onPress={() => onPrompt("reject_payment")} style={styles.action} />
            <Button
              label="Confirm payment"
              variant={approvalFollowsPayment(row.steps) ? "secondary" : "primary"}
              icon="checkmark"
              disabled={busy}
              onPress={() =>
                onDecide(
                  { action: "confirm_payment", paymentId: p.id },
                  { title: "Confirm this payment?", body: `You checked that ${p.amountLabel} from ${name} arrived.`, label: "Confirm" },
                )
              }
              style={styles.action}
            />
            {approvalFollowsPayment(row.steps) ? (
              <Button
                label="Confirm & approve"
                icon="checkmark-done"
                disabled={busy}
                onPress={() =>
                  onDecide(
                    { action: "confirm_and_approve", paymentId: p.id },
                    { title: `Confirm and approve ${name}?`, body: "The payment is confirmed and they're let in right away.", label: "Confirm & approve" },
                  )
                }
                style={styles.action}
              />
            ) : null}
          </>
        ) : null}
        {row.status === "approval_pending" ? (
          <>
            <Button label="Reject" variant="secondary" disabled={busy} onPress={() => onPrompt("reject")} style={styles.action} />
            <Button
              label="Approve"
              icon="checkmark"
              disabled={busy}
              onPress={() =>
                onDecide(
                  { action: "approve", membershipId: row.id },
                  { title: `Approve ${name}?`, body: "They move to their next step (or straight in) and are told right away.", label: "Approve" },
                )
              }
              style={styles.action}
            />
          </>
        ) : null}
        {REJECTABLE_EARLY.has(row.status) ? (
          <Button label="Reject" variant="secondary" disabled={busy} onPress={() => onPrompt("reject")} style={styles.action} />
        ) : null}
        {row.status === "rejected" && REFUND_OPEN.has(row.refundStatus) ? (
          <Button label="Mark refunded" icon="cash-outline" disabled={busy} onPress={() => onPrompt("refund")} style={styles.action} />
        ) : null}
        {row.status === "active" ? (
          <Button label="Revoke" variant="danger" disabled={busy} onPress={() => onPrompt("revoke")} style={styles.action} />
        ) : null}
      </View>
    </View>
  );
}

function Warning({ text }: { text: string }) {
  const warn = useTheme().tone("warning");
  return (
    <View style={[styles.warn, { backgroundColor: warn.bg }]}>
      <Ionicons name="alert-circle-outline" size={16} color={warn.fg} />
      <AppText variant="caption" color={warn.fg} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

function ProofButton({ paymentId }: { paymentId: string }) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      await openLink(await paidAccessProofUrl(paymentId));
    } catch (e) {
      Alert.alert("Couldn't open the proof", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setOpening(false);
    }
  };
  return <Button label="View proof" icon="image-outline" variant="secondary" loading={opening} onPress={() => void open()} style={styles.action} />;
}

const styles = StyleSheet.create({
  card: { padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACE.md },
  head: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
  pills: { alignItems: "flex-end", gap: SPACE.xs, flexShrink: 0, maxWidth: "50%" },
  facts: { gap: SPACE.xs },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  factValue: { flexShrink: 1, textAlign: "right" },
  answers: { gap: SPACE.sm, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  warn: { flexDirection: "row", gap: SPACE.sm, alignItems: "flex-start", padding: SPACE.sm, borderRadius: RADIUS.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  action: { flexGrow: 1, minHeight: TOUCH },
});
