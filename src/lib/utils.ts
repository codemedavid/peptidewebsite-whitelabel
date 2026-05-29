import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(cents: number, currency = "USD") {
  const amount = (cents ?? 0) / 100;
  // `currency` must be an ISO 4217 code for the `currency` style; a tenant whose
  // brand currency is a bare symbol (e.g. "₱") would otherwise throw a
  // RangeError. Fall back to prefixing the raw value with whatever we were given.
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency}${amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
