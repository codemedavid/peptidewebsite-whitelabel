/**
 * The setup screen's form (spec §5.2) and its conversion to a protocol. Pure,
 * so the rules (what blocks Save, how a schedule is built) are testable. The
 * dose always starts empty: the member enters every number.
 */
import { capText, INPUT_CAPS } from "./caps";
import { computeDraw, parseAmount, parseDoseText, type Draw } from "./dose-math";
import { CYCLE_PRESETS } from "./schedule";
import {
  PROTOCOL_COLORS,
  type Cycle,
  type DoseUnit,
  type Protocol,
  type RecordSource,
  type Route,
  type ScheduleRule,
  type SyringeKind,
  type VialUnit,
} from "./types";

export type RouteGroup = "vial" | "pen" | "oral" | "other";
export type ScheduleKind = "daily" | "everyOther" | "weekdays" | "interval" | "asNeeded";
export type CycleKey = "off" | "5-2" | "8w-4w" | "custom";

export interface ProtocolForm {
  name: string;
  catalogId: string | null;
  category: string | null;
  color: string;
  routeGroup: RouteGroup;
  /** Only for "Other": nasal / topical / other. */
  otherRoute: "nasal" | "topical" | "other";
  vialAmount: string;
  vialUnit: VialUnit;
  waterMl: string;
  doseValue: string;
  doseUnit: DoseUnit;
  syringe: SyringeKind;
  scheduleKind: ScheduleKind;
  everyDays: number;
  days: number[];
  times: string[];
  cycleKey: CycleKey;
  cycleOn: string;
  cycleOff: string;
  cycleInWeeks: boolean;
  startDate: string;
  endDate: string | null;
  reminders: boolean;
  rotateSites: boolean;
  /** Hours, typed by the user (blank = no level curve). Never filled in by the app. */
  halfLifeHours: string;
  /** Kept from a guide import so the review screen can label it "From <store>'s guide". */
  source: RecordSource | null;
}

export const MAX_TIMES = INPUT_CAPS.times;
export const MIN_EVERY = 2;
export const MAX_EVERY = INPUT_CAPS.everyDays;
/** A typo guard for the half-life field (a few weeks). */
export const MAX_HALF_LIFE_HOURS = 24 * 60;

export function emptyForm(today: string, syringe: SyringeKind, colorIndex = 0): ProtocolForm {
  return {
    name: "",
    catalogId: null,
    category: null,
    color: PROTOCOL_COLORS[colorIndex % PROTOCOL_COLORS.length],
    routeGroup: "vial",
    otherRoute: "nasal",
    vialAmount: "",
    vialUnit: "mg",
    waterMl: "",
    doseValue: "",
    doseUnit: "mcg",
    syringe,
    scheduleKind: "daily",
    everyDays: 3,
    days: [1, 4],
    times: ["08:00"],
    cycleKey: "off",
    cycleOn: "5",
    cycleOff: "2",
    cycleInWeeks: false,
    startDate: today,
    endDate: null,
    reminders: true,
    rotateSites: true,
    halfLifeHours: "",
    source: null,
  };
}

/** The vial size from a catalog strength ("5mg", "10mg · 5mg") — a product fact, not a dose. */
export function vialFromStrength(strength: string | null | undefined): { vialAmount: string; vialUnit: VialUnit } | null {
  const dose = parseDoseText(strength ?? "");
  if (!dose || (dose.unit !== "mg" && dose.unit !== "mcg" && dose.unit !== "iu")) return null;
  return { vialAmount: String(dose.value), vialUnit: dose.unit };
}

export function routeOf(form: Pick<ProtocolForm, "routeGroup" | "otherRoute">): Route {
  if (form.routeGroup === "vial") return "injection";
  if (form.routeGroup === "other") return form.otherRoute;
  return form.routeGroup;
}

function cycleOf(form: ProtocolForm): Cycle | null {
  if (form.cycleKey === "off") return null;
  const preset = CYCLE_PRESETS.find((c) => c.key === form.cycleKey);
  if (preset) return preset.cycle;
  const on = Number(form.cycleOn);
  const off = Number(form.cycleOff);
  if (!Number.isInteger(on) || !Number.isInteger(off) || on < 1 || off < 0) return null;
  const k = form.cycleInWeeks ? 7 : 1;
  return { onDays: on * k, offDays: off * k };
}

function ruleOf(form: ProtocolForm): ScheduleRule {
  switch (form.scheduleKind) {
    case "daily":
      return { kind: "daily" };
    case "everyOther":
      return { kind: "interval", everyDays: 2 };
    case "interval":
      return { kind: "interval", everyDays: Math.min(MAX_EVERY, Math.max(MIN_EVERY, Math.round(form.everyDays))) };
    case "weekdays":
      return { kind: "weekdays", days: [...new Set(form.days)].sort((a, b) => a - b) };
    case "asNeeded":
      return { kind: "asNeeded" };
  }
}

/** The live draw for the result panel (only a vial has a mix). */
export function formDraw(form: ProtocolForm): Draw {
  if (form.routeGroup !== "vial") return { kind: "empty" };
  return computeDraw(
    { vialAmount: parseAmount(form.vialAmount) ?? 0, vialUnit: form.vialUnit, waterMl: parseAmount(form.waterMl) ?? 0 },
    { value: parseAmount(form.doseValue) ?? 0, unit: form.doseUnit },
    form.syringe,
  );
}

export type FormResult = { ok: true; protocol: Omit<Protocol, "id" | "createdAt" | "updatedAt" | "deletedAt" | "status"> } | { ok: false; reason: string };

/** Checks the form; returns the protocol fields to save, or why Save is off. */
export function formToProtocol(form: ProtocolForm): FormResult {
  const name = form.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "Choose what you’re taking." };
  const value = parseAmount(form.doseValue);
  if (value === null || value <= 0) return { ok: false, reason: "Enter your dose." };
  const draw = formDraw(form);
  if (draw.kind !== "empty" && draw.isBlocked) return { ok: false, reason: "Check your numbers." };
  if (form.scheduleKind === "weekdays" && form.days.length === 0) return { ok: false, reason: "Pick at least one day." };
  if (form.scheduleKind !== "asNeeded" && form.times.length === 0) return { ok: false, reason: "Add a time." };
  if (form.cycleKey === "custom" && !cycleOf(form)) return { ok: false, reason: "Enter the days on and off." };
  if (form.endDate && form.endDate < form.startDate) return { ok: false, reason: "The end date is before the start." };
  const halfLife = form.halfLifeHours.trim() ? parseAmount(form.halfLifeHours) : null;
  if (form.halfLifeHours.trim() && (halfLife === null || halfLife <= 0 || halfLife > MAX_HALF_LIFE_HOURS)) {
    return { ok: false, reason: "Enter the half-life in hours, or leave it blank." };
  }

  const route = routeOf(form);
  const vialAmount = parseAmount(form.vialAmount);
  const waterMl = parseAmount(form.waterMl);
  const hasMix = form.routeGroup === "vial" && vialAmount !== null && vialAmount > 0 && waterMl !== null && waterMl > 0;
  return {
    ok: true,
    protocol: {
      // Typed names are capped by the field; a store guide's aren't — never exceed the server's caps.
      name: capText(name, "name"),
      catalogId: form.catalogId,
      category: form.category ? capText(form.category, "category") : null,
      color: form.color,
      route,
      dose: { value, unit: form.doseUnit },
      mix: hasMix ? { vialAmount, vialUnit: form.vialUnit, waterMl } : null,
      syringe: form.routeGroup === "vial" ? form.syringe : null,
      schedule: ruleOf(form),
      cycle: form.scheduleKind === "asNeeded" ? null : cycleOf(form),
      times: [...new Set(form.times)].sort().slice(0, MAX_TIMES),
      startDate: form.startDate,
      endDate: form.endDate,
      reminders: form.reminders,
      rotateSites: (route === "injection" || route === "pen") && form.rotateSites,
      checkDose: false,
      halfLifeHours: halfLife,
      source: form.source,
    },
  };
}

/** The form for editing an existing protocol. */
export function formFromProtocol(p: Protocol, fallbackSyringe: SyringeKind): ProtocolForm {
  const routeGroup: RouteGroup = p.route === "injection" ? "vial" : p.route === "pen" || p.route === "oral" ? p.route : "other";
  const preset = p.cycle ? CYCLE_PRESETS.find((c) => c.cycle.onDays === p.cycle?.onDays && c.cycle.offDays === p.cycle?.offDays) : undefined;
  const inWeeks = !!p.cycle && p.cycle.onDays % 7 === 0 && p.cycle.offDays % 7 === 0;
  const scheduleKind: ScheduleKind =
    p.schedule.kind === "interval" ? (p.schedule.everyDays === 2 ? "everyOther" : "interval") : p.schedule.kind === "weekdays" ? "weekdays" : p.schedule.kind;
  return {
    name: p.name,
    catalogId: p.catalogId,
    category: p.category,
    color: p.color,
    routeGroup,
    otherRoute: p.route === "nasal" || p.route === "topical" ? p.route : "other",
    vialAmount: p.mix ? String(p.mix.vialAmount) : "",
    vialUnit: p.mix?.vialUnit ?? "mg",
    waterMl: p.mix ? String(p.mix.waterMl) : "",
    doseValue: p.dose.value > 0 ? String(p.dose.value) : "",
    doseUnit: p.dose.unit,
    syringe: p.syringe ?? fallbackSyringe,
    scheduleKind,
    everyDays: p.schedule.kind === "interval" ? p.schedule.everyDays : 3,
    days: p.schedule.kind === "weekdays" ? p.schedule.days : [1, 4],
    times: p.times.length > 0 ? p.times : ["08:00"],
    cycleKey: !p.cycle ? "off" : preset ? (preset.key as CycleKey) : "custom",
    cycleOn: p.cycle ? String(inWeeks ? p.cycle.onDays / 7 : p.cycle.onDays) : "5",
    cycleOff: p.cycle ? String(inWeeks ? p.cycle.offDays / 7 : p.cycle.offDays) : "2",
    cycleInWeeks: inWeeks,
    startDate: p.startDate,
    endDate: p.endDate,
    reminders: p.reminders,
    rotateSites: p.rotateSites,
    halfLifeHours: p.halfLifeHours ? String(p.halfLifeHours) : "",
    source: p.source ?? null,
  };
}

/** Dose units offered per route. */
export function unitsFor(group: RouteGroup): DoseUnit[] {
  switch (group) {
    case "vial":
      return ["mcg", "mg", "iu"];
    case "pen":
      return ["mg", "mcg"];
    case "oral":
      return ["mg", "caps"];
    case "other":
      return ["mcg", "mg", "iu", "ml", "units"];
  }
}

/** The parts of a store guide (TrackerStoreGuide) the setup form can use. */
export interface GuideDraft {
  name: string;
  category?: string | null;
  dosage?: string | null;
}

/**
 * An editable draft copied from the store's guide: the name, and the dose only
 * when the guide states one plainly. Nothing else is filled in and nothing is
 * scheduled until the user reviews and saves (docs/mobile-admin/TRACKER.md §6).
 */
export function formFromGuide(guide: GuideDraft, base: ProtocolForm): ProtocolForm {
  const name = guide.name.trim().replace(/\s+/g, " ");
  const dose = parseDoseText(guide.dosage ?? "");
  const usable = dose && unitsFor(base.routeGroup).includes(dose.unit);
  return {
    ...base,
    name: name || base.name,
    category: guide.category?.trim() || base.category,
    doseValue: usable ? String(dose.value) : base.doseValue,
    doseUnit: usable ? dose.unit : base.doseUnit,
    source: name ? { kind: "guide", name } : base.source,
  };
}
