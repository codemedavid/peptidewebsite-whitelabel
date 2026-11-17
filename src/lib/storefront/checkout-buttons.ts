// Checkout button wording — the owner's own words on the buttons that move a
// customer through checkout ("Checkout", "Continue to payment", "Place order",
// the "Send your order via" line and the chat-channel buttons). Plain copy, so
// it is NOT gated behind Smart Checkout: any store can say "Deserve ko 'to!"
// instead of "Checkout". Persisted in branding.config.checkoutButtons, edited by
// the operator in Tenant Settings → Checkout copy.
//
// Pure (no server-only, no React) so the settings editor, the save action and
// the storefront cart all normalize identically. Blank = the built-in wording.

export const CHECKOUT_BUTTON_MAX = 40;
/** The persuasion line shown above a step's button can run a little longer. */
export const CHECKOUT_NUDGE_MAX = 160;

/** The `{channel}` token in the channel-button text becomes "WhatsApp" etc. */
export const CHANNEL_TOKEN = "{channel}";

export type CheckoutButtonKey =
  | "cart"
  | "payment"
  | "place"
  | "channelsHeading"
  | "channel"
  // Nudges: an optional line above each step's button (a reason to finish plus
  // a feeling: "Ilang tap na lang, deserve mo 'to"). Blank = no line at all.
  | "cartNudge"
  | "detailsNudge"
  | "paymentNudge";

export const CHECKOUT_NUDGE_KEYS: readonly CheckoutButtonKey[] = ["cartNudge", "detailsNudge", "paymentNudge"];

export function checkoutFieldMax(key: CheckoutButtonKey): number {
  return CHECKOUT_NUDGE_KEYS.includes(key) ? CHECKOUT_NUDGE_MAX : CHECKOUT_BUTTON_MAX;
}

export type CheckoutButtons = Record<CheckoutButtonKey, string>;

/** Built-in wording, shown whenever the owner leaves a field blank. */
export const CHECKOUT_BUTTON_DEFAULTS: CheckoutButtons = {
  cart: "Checkout",
  payment: "Continue to payment",
  place: "Place order",
  channelsHeading: "Send your order via",
  channel: CHANNEL_TOKEN,
  cartNudge: "",
  detailsNudge: "",
  paymentNudge: "",
};

export const CHECKOUT_BUTTON_KEYS = Object.keys(CHECKOUT_BUTTON_DEFAULTS) as CheckoutButtonKey[];

const EMPTY: CheckoutButtons = {
  cart: "",
  payment: "",
  place: "",
  channelsHeading: "",
  channel: "",
  cartNudge: "",
  detailsNudge: "",
  paymentNudge: "",
};

/** Coerce an untrusted/absent config value into trimmed, capped strings. */
export function normalizeCheckoutButtons(input: unknown): CheckoutButtons {
  const x = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return CHECKOUT_BUTTON_KEYS.reduce<CheckoutButtons>(
    (out, key) => {
      const v = x[key];
      return {
        ...out,
        [key]: typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, checkoutFieldMax(key)) : "",
      };
    },
    { ...EMPTY },
  );
}

/** The owner's wording for a button, else the built-in. */
export function checkoutButtonLabel(buttons: CheckoutButtons, key: CheckoutButtonKey): string {
  return buttons[key] || CHECKOUT_BUTTON_DEFAULTS[key];
}

/**
 * The text on one chat-channel button. `{channel}` is replaced by the channel
 * name. Without the token, the owner's text stands alone when the store has a
 * single channel; with two or more, the channel name is appended so the
 * buttons stay tellable apart ("Deserve ko 'to · WhatsApp").
 */
export function channelButtonLabel(
  buttons: CheckoutButtons,
  channelName: string,
  channelCount: number,
): string {
  const template = checkoutButtonLabel(buttons, "channel");
  if (template.includes(CHANNEL_TOKEN)) return template.split(CHANNEL_TOKEN).join(channelName);
  return channelCount > 1 ? `${template} · ${channelName}` : template;
}
