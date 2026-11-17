"use client";

// Tenant Settings → Checkout copy: the wording on each checkout button
// (lib/storefront/checkout-buttons). Presentational — TenantSettingsView owns
// the state, dirty tracking and save (saveContactChannelsAction).

import {
  CHECKOUT_BUTTON_DEFAULTS,
  CHANNEL_TOKEN,
  checkoutFieldMax,
  type CheckoutButtonKey,
  type CheckoutButtons,
} from "@/lib/storefront/checkout-buttons";

type Row = { key: CheckoutButtonKey; label: string; help: string };

const ROWS: readonly Row[] = [
  {
    key: "cartNudge",
    label: "Cart: line above the button",
    help: "Optional. One reason to finish plus a feeling, e.g. “Ilang tap na lang 'to. Deserve mo 'to!”. Blank shows nothing.",
  },
  {
    key: "cart",
    label: "Cart button",
    help: "The main button in the cart that starts checkout. Make it a nudge, e.g. “Deserve ko ’to!”.",
  },
  {
    key: "detailsNudge",
    label: "Details: line above the button",
    help: "Optional. Shown on the step where the customer types their name and address.",
  },
  {
    key: "payment",
    label: "Details → payment button",
    help: "Shown after the customer fills in their details, when the store asks for payment.",
  },
  {
    key: "paymentNudge",
    label: "Payment: line above the button",
    help: "Optional. Shown on the payment step, right before they send the order.",
  },
  {
    key: "place",
    label: "Final order button",
    help: "Places the order on stores with no chat channel turned on.",
  },
  {
    key: "channelsHeading",
    label: "Line above the chat buttons",
    help: "Shown above the WhatsApp / Telegram / Messenger buttons on the last step.",
  },
  {
    key: "channel",
    label: "Chat button text",
    help: `Use ${CHANNEL_TOKEN} for the app name (“Order via ${CHANNEL_TOKEN}”). Without it, the app name is added automatically when you have more than one channel.`,
  },
];

type Props = {
  value: CheckoutButtons;
  onChange: (next: CheckoutButtons) => void;
};

export function CheckoutButtonsRows({ value, onChange }: Props) {
  return (
    <>
      {ROWS.map(({ key, label, help }) => (
        <div className="set-row" key={key}>
          <div>
            <div className="set-row-label">{label}</div>
            <div className="set-row-help">{help}</div>
          </div>
          <div className="set-row-control">
            <input
              className="input"
              value={value[key]}
              maxLength={checkoutFieldMax(key)}
              placeholder={CHECKOUT_BUTTON_DEFAULTS[key] || "(no line)"}
              aria-label={label}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
            <div className="set-counter">
              {value[key].length}/{checkoutFieldMax(key)}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
