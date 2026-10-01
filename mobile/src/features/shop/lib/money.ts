import { formatMoney } from "../../admin/catalog/currency";

/**
 * Shop money: the store's own currency and format (the same rules the admin
 * uses, re-derived from the website). Amounts always come from the server.
 */
export function money(amount: number, currency: string): string {
  return formatMoney(amount, currency);
}

/** "-₱50.00" for discounts. */
export function minus(amount: number, currency: string): string {
  return `-${formatMoney(Math.abs(amount), currency)}`;
}
