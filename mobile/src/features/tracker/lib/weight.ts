/** Weight is stored in kg and shown in the member's unit (Tracker settings). */
import { KG_PER_LB, LB_PER_KG, type WeightUnit } from "./types";

export function toUnit(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg * LB_PER_KG;
}

export function toKg(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

/** "158.4 lb" / "71.9 kg". */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${toUnit(kg, unit).toFixed(1)} ${unit}`;
}

/** The countries that weigh people in pounds (everyone else uses kg). */
export const LB_REGIONS: readonly string[] = ["US", "LR", "MM"];

/** "en-US" / "es_419" / "zh-Hant-TW" → "US" / "419" / "TW"; null when the locale names no region. */
export function regionOf(locale: string | null | undefined): string | null {
  if (!locale) return null;
  const parts = locale.replace(/_/g, "-").split("-").slice(1);
  const region = parts.find((p) => /^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p));
  return region ? region.toUpperCase() : null;
}

/** lb in the US, Liberia and Myanmar; kg everywhere else (and when the region is unknown). */
export function weightUnitForLocale(locale: string | null | undefined): WeightUnit {
  const region = regionOf(locale);
  return region && LB_REGIONS.includes(region) ? "lb" : "kg";
}

/** The device's locale ("en-US"), from the browser on web and Intl on phones (Hermes reads the system locale). */
export function deviceLocale(): string | null {
  try {
    const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
    const fromBrowser = nav?.languages?.[0] ?? nav?.language;
    if (fromBrowser && regionOf(fromBrowser)) return fromBrowser;
    return Intl.DateTimeFormat().resolvedOptions().locale || fromBrowser || null;
  } catch {
    return null;
  }
}

/** A fresh install's weight unit, from the device's region. */
export function deviceWeightUnit(): WeightUnit {
  return weightUnitForLocale(deviceLocale());
}
