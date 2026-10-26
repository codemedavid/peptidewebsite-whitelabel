import { ChoicePills, Section } from "@/features/admin/setup/ui";
import { useGroupBuySetting } from "./hooks";
import type { GroupBuyInvoiceConfig } from "./invoice";
import { GB_PAYMENT_MODES, GB_PAYMENT_MODE_COPY, type GbPaymentMode } from "./payment-mode";

/**
 * When customers pay for a group-buy order (saveGroupBuyPaymentModeAction):
 * before checkout, or after the round closes. One store setting — the website
 * checkout, this app's shop and the operator console all read the same one.
 * The server keeps the invoice switch in step and answers with it, so the
 * invoice card below follows without a refetch.
 */

type SaveResult = { ok: true; mode: GbPaymentMode; invoice: GroupBuyInvoiceConfig };

const OPTIONS = GB_PAYMENT_MODES.map((key) => ({ key, ...GB_PAYMENT_MODE_COPY[key] }));

export function PaymentModeCard({
  value,
  setValue,
  onInvoice,
}: {
  value: GbPaymentMode;
  setValue: (v: GbPaymentMode) => void;
  /** The invoice settings as the server stored them alongside the mode. */
  onInvoice: (invoice: GroupBuyInvoiceConfig) => void;
}) {
  const save = useGroupBuySetting<SaveResult>("saveGroupBuyPaymentModeAction");
  return (
    <Section title="How customers pay" hint="For group-buy orders, on the website and in the app.">
      <ChoicePills<GbPaymentMode>
        label="Customers pay"
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          if (save.isPending) return;
          const prev = value;
          setValue(next);
          save.mutate(next, {
            onSuccess: (res) => {
              setValue(res.mode);
              onInvoice(res.invoice);
            },
            onError: () => setValue(prev),
          });
        }}
      />
    </Section>
  );
}
