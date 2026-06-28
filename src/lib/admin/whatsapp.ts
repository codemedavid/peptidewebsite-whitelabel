// Super-admin → tenant WhatsApp quick-contact helpers.
//
// The operator stores a per-tenant WhatsApp number so they can one-tap message
// the tenant owner (a wa.me click-to-chat link) when they need to follow up.
// Numbers are typed in any human format and normalized to a bare dial string;
// the same digits feed straight into the wa.me URL.

/** E.164 allows up to 15 digits incl. country code; 8 is a safe practical floor. */
const MIN_DIAL_DIGITS = 8;
const MAX_DIAL_DIGITS = 15;

/** Strip everything but digits — drops +, spaces, dashes, dots and parentheses. */
export function toWaDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export type WhatsappValidation = { digits: string } | { error: string };

/**
 * Normalize and validate an operator-typed WhatsApp number. Returns the bare
 * dial string on success, or a user-facing error when it can't be dialed.
 */
export function validateWhatsapp(raw: string): WhatsappValidation {
  const digits = toWaDigits(raw);
  if (!digits) return { error: "Enter a WhatsApp number." };
  if (digits.length < MIN_DIAL_DIGITS) {
    return { error: "That number looks too short — use the full international format (e.g. 639171234567)." };
  }
  if (digits.length > MAX_DIAL_DIGITS) {
    return { error: "That number looks too long — use the international format, digits only." };
  }
  return { digits };
}

/**
 * Build a wa.me click-to-chat link. `digits` must already be a bare dial string
 * (see toWaDigits/validateWhatsapp). A non-empty greeting is URL-encoded into
 * the `text` param so WhatsApp opens with the message prefilled.
 */
export function buildWaLink(digits: string, text?: string): string {
  const base = `https://wa.me/${digits}`;
  const message = text?.trim();
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
