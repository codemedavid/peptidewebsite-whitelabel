import { View } from "react-native";
import { SPACE } from "@/theme/tokens";
import { ChoicePills, Hint, Section, ToggleRow, type Choice } from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AMOUNT_TOKEN, COPY_LIMITS, type PaidAccessCopy, type PaidAccessPaymentMethod, type PaidAccessRefundPolicy, type PaidAccessSettings, type PaidAccessStep, type PaidAccessVisibility } from "./model";

/**
 * The Join settings editor's field groups. Number/date inputs are edited as
 * text (`EditorTexts`) and only turned into settings on save, so a half-typed
 * "49." never becomes a stored amount. Copy follows the website panel
 * (src/modules/paid-access/ui/settings-fields.tsx).
 */

export type EditorTexts = { amount: string; limitSlots: boolean; slots: string; opensAt: string; closesAt: string };

type SectionProps = {
  draft: PaidAccessSettings;
  texts: EditorTexts;
  onDraft: (next: PaidAccessSettings) => void;
  onTexts: (patch: Partial<EditorTexts>) => void;
  errorFor: (path: string) => string | null;
};

const AMOUNT_MODES: readonly Choice<"full" | "deposit">[] = [
  { key: "full", label: "Join fee", hint: "Kept by the store" },
  { key: "deposit", label: "Deposit", hint: "Credited to their order" },
];

const METHODS: readonly Choice<PaidAccessPaymentMethod>[] = [
  { key: "manual", label: "Upload proof" },
  { key: "online", label: "Pay online" },
  { key: "either", label: "Either" },
];

const REFUNDS: readonly Choice<PaidAccessRefundPolicy>[] = [
  { key: "manual", label: "I refund by hand" },
  { key: "auto", label: "Refund automatically" },
  { key: "none", label: "No refund" },
];

const WINDOWS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: "No limit" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 180, label: "3 hours" },
  { minutes: 1440, label: "24 hours" },
];

const VISIBILITY: readonly Choice<PaidAccessVisibility>[] = [
  { key: "summary", label: "A summary", hint: "Name, dates, slots" },
  { key: "nothing", label: "Nothing", hint: "Just how to join" },
];

const NOTIFY: { key: keyof PaidAccessSettings["notify"]; label: string }[] = [
  { key: "paid", label: "Member: payment confirmed" },
  { key: "approved", label: "Member: approved / off the waitlist" },
  { key: "rejected", label: "Member: rejected, refunded or removed" },
  { key: "newPending", label: "Store team: something is waiting for review" },
];

const windowKey = (m: number | null) => (m === null ? "none" : String(m));

export function PaymentSection({ draft, texts, onDraft, onTexts, errorFor, currency, onlineAvailable }: SectionProps & { currency: string; onlineAvailable: boolean }) {
  const p = draft.payment;
  const windows = WINDOWS.some((w) => w.minutes === p.windowMinutes) ? WINDOWS : [...WINDOWS, { minutes: p.windowMinutes, label: `${p.windowMinutes} min` }];
  const setPayment = (patch: Partial<PaidAccessSettings["payment"]>) => onDraft({ ...draft, payment: { ...p, ...patch } });
  return (
    <Section title="Payment" hint="A payment only counts once you check the proof (or a verified online payment arrives).">
      <Field
        label={`Amount (${currency})`}
        value={texts.amount}
        onChangeText={(amount) => onTexts({ amount })}
        keyboardType="decimal-pad"
        placeholder="500"
        error={errorFor("payment.amountCents")}
      />
      <ChoicePills label="This is a…" options={AMOUNT_MODES} value={p.amountMode} onChange={(amountMode) => setPayment({ amountMode })} />
      <View style={{ gap: SPACE.xs }}>
        <ChoicePills label="How members pay" options={METHODS} value={p.method} onChange={(method) => setPayment({ method })} />
        {errorFor("payment.method") ? (
          <Hint tone="danger">{errorFor("payment.method")}</Hint>
        ) : !onlineAvailable ? (
          <Hint>Online payments aren&apos;t connected for this store yet — use proof upload for now.</Hint>
        ) : null}
      </View>
      <View style={{ gap: SPACE.xs }}>
        <ChoicePills
          label="Release an unpaid slot after"
          options={windows.map((w) => ({ key: windowKey(w.minutes), label: w.label }))}
          value={windowKey(p.windowMinutes)}
          onChange={(k) => setPayment({ windowMinutes: k === "none" ? null : Number(k) })}
        />
        {errorFor("payment.windowMinutes") ? <Hint tone="danger">{errorFor("payment.windowMinutes")}</Hint> : null}
      </View>
      <View style={{ gap: SPACE.xs }}>
        <ChoicePills label="If you reject someone who paid" options={REFUNDS} value={draft.refundOnReject} onChange={(refundOnReject) => onDraft({ ...draft, refundOnReject })} />
        {errorFor("refundOnReject") ? <Hint tone="danger">{errorFor("refundOnReject")}</Hint> : null}
      </View>
    </Section>
  );
}

export function CapacitySection({ draft, texts, onDraft, onTexts, errorFor, slotsTaken }: SectionProps & { slotsTaken: number }) {
  return (
    <Section title="Slots" hint="A slot is held from the moment someone starts joining. A released or rejected slot goes to the waitlist first.">
      <ToggleRow
        label="Limit the number of members"
        hint={slotsTaken > 0 ? `${slotsTaken} slot${slotsTaken === 1 ? "" : "s"} taken right now.` : undefined}
        value={texts.limitSlots}
        onChange={(limitSlots) => {
          onTexts({ limitSlots });
          if (!limitSlots) onDraft({ ...draft, capacity: { ...draft.capacity, waitlist: false } });
        }}
      />
      {texts.limitSlots ? (
        <>
          <Field
            label="Maximum members"
            value={texts.slots}
            onChangeText={(slots) => onTexts({ slots })}
            keyboardType="number-pad"
            placeholder="50"
            error={errorFor("capacity.maxSlots")}
          />
          <ToggleRow
            label="Waitlist when full"
            hint="New joiners wait in line and move in when a slot opens."
            value={draft.capacity.waitlist}
            onChange={(waitlist) => onDraft({ ...draft, capacity: { ...draft.capacity, waitlist } })}
          />
        </>
      ) : null}
      {errorFor("capacity.waitlist") ? <Hint tone="danger">{errorFor("capacity.waitlist")}</Hint> : null}
    </Section>
  );
}

export function ScheduleSection({ texts, onTexts, errorFor }: SectionProps) {
  return (
    <Section title="Joining window" hint="Leave blank to follow the round's own dates. Payments are refused once joining closes.">
      <Field
        label="Opens"
        value={texts.opensAt}
        onChangeText={(opensAt) => onTexts({ opensAt })}
        placeholder="YYYY-MM-DD HH:MM"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={errorFor("schedule.opensAt")}
      />
      <Field
        label="Closes"
        value={texts.closesAt}
        onChangeText={(closesAt) => onTexts({ closesAt })}
        placeholder="YYYY-MM-DD HH:MM"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        error={errorFor("schedule.closesAt")}
      />
    </Section>
  );
}

export function AudienceSection({ draft, onDraft }: SectionProps) {
  return (
    <>
      <Section title="Before they're in" hint="What a customer who hasn't got access yet can see of this round.">
        <ChoicePills label="They see" options={VISIBILITY} value={draft.pendingVisibility} onChange={(pendingVisibility) => onDraft({ ...draft, pendingVisibility })} />
      </Section>
      <Section title="Notifications">
        {NOTIFY.map((n) => (
          <ToggleRow
            key={n.key}
            label={n.label}
            value={draft.notify[n.key]}
            onChange={(v) => onDraft({ ...draft, notify: { ...draft.notify, [n.key]: v } })}
          />
        ))}
      </Section>
    </>
  );
}

const EMPTY_COPY: PaidAccessCopy = { intro: "", button: "", note: "", steps: { form: "", payment: "", approval: "", access: "" } };

const STEP_PLACEHOLDER: Record<PaidAccessStep, { name: string; placeholder: string }> = {
  form: { name: "Application form", placeholder: "Application form" },
  payment: { name: "Payment", placeholder: `Pay ${AMOUNT_TOKEN}` },
  approval: { name: "Admin approval", placeholder: "Admin approval" },
};

/** "Join page text" — optional; a blank field keeps the built-in words (its placeholder). */
export function CopySection({ draft, onDraft, errorFor }: SectionProps) {
  // An older server sends no copy: start from blanks.
  const copy = draft.copy ?? EMPTY_COPY;
  const set = (patch: Partial<PaidAccessCopy>) => onDraft({ ...draft, copy: { ...copy, ...patch } });
  const setStep = (key: keyof PaidAccessCopy["steps"], value: string) => set({ steps: { ...copy.steps, [key]: value } });
  return (
    <Section title="Join page text" hint="Optional. Leave a field blank to keep the wording shown in grey.">
      <Field
        label="Description"
        value={copy.intro}
        onChangeText={(intro) => set({ intro })}
        placeholder="8 products are waiting in this group buy. Members see the prices and can order."
        maxLength={COPY_LIMITS.intro}
        multiline
        error={errorFor("copy.intro")}
      />
      <Field label="Button" value={copy.button} onChangeText={(button) => set({ button })} placeholder="Get access" maxLength={COPY_LIMITS.button} error={errorFor("copy.button")} />
      <Field
        label="Note under the button"
        value={copy.note}
        onChangeText={(note) => set({ note })}
        placeholder="Already approved? Verify your email on the next screen — no account needed."
        maxLength={COPY_LIMITS.note}
        multiline
        error={errorFor("copy.note")}
      />
      {draft.steps.map((s) => (
        <Field
          key={s}
          label={`Step name: ${STEP_PLACEHOLDER[s].name}`}
          value={copy.steps[s]}
          onChangeText={(v) => setStep(s, v)}
          placeholder={STEP_PLACEHOLDER[s].placeholder}
          maxLength={COPY_LIMITS.step}
          hint={s === "payment" ? `Type ${AMOUNT_TOKEN} to show the price.` : undefined}
          error={errorFor(`copy.steps.${s}`)}
        />
      ))}
      {draft.steps.length > 0 ? (
        <Field label="Last step" value={copy.steps.access} onChangeText={(v) => setStep("access", v)} placeholder="Access" maxLength={COPY_LIMITS.step} error={errorFor("copy.steps.access")} />
      ) : null}
    </Section>
  );
}
