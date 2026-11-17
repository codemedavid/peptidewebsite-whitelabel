// Shared fixtures for the mobile/scripts/test-tracker-*.ts unit tests (not a test file itself).
import type { DoseLog, Protocol, SkipLog, Vial } from "../src/features/tracker/lib/types";

export function makeTest() {
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  };
  const done = () => console.log(`\n${passed} passed`);
  return { test, done };
}

const STAMP = "2026-01-01T00:00:00.000Z";

export function protocol(over: Partial<Protocol> = {}): Protocol {
  return {
    id: "p1",
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    name: "BPC-157",
    catalogId: null,
    category: null,
    color: "#7C3AED",
    route: "injection",
    dose: { value: 250, unit: "mcg" },
    mix: { vialAmount: 5, vialUnit: "mg", waterMl: 2 },
    syringe: "u100_1ml",
    schedule: { kind: "daily" },
    cycle: null,
    times: ["08:00"],
    startDate: "2026-09-01",
    endDate: null,
    status: "active",
    reminders: true,
    rotateSites: true,
    checkDose: false,
    ...over,
  };
}

let doseSeq = 0;
export function dose(takenAt: Date, over: Partial<DoseLog> = {}): DoseLog {
  doseSeq += 1;
  return {
    id: `d${doseSeq}`,
    createdAt: takenAt.toISOString(),
    updatedAt: takenAt.toISOString(),
    deletedAt: null,
    protocolId: "p1",
    name: "BPC-157",
    takenAt: takenAt.toISOString(),
    scheduledFor: null,
    dose: { value: 250, unit: "mcg" },
    volumeMl: 0.1,
    units: 10,
    route: "injection",
    site: null,
    vialId: null,
    note: null,
    ...over,
  };
}

export function skip(scheduledFor: Date, over: Partial<SkipLog> = {}): SkipLog {
  return {
    id: `s${scheduledFor.getTime()}`,
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    protocolId: "p1",
    scheduledFor: scheduledFor.toISOString(),
    reason: "rest",
    note: null,
    ...over,
  };
}

export function vial(over: Partial<Vial> = {}): Vial {
  return {
    id: "v1",
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    protocolId: "p1",
    amount: 5,
    unit: "mg",
    waterMl: 2,
    mixedOn: "2026-09-30",
    lot: null,
    status: "active",
    ...over,
  };
}

/** Local time on 2026-10-<day>. */
export const oct = (day: number, h = 8, m = 0) => new Date(2026, 9, day, h, m, 0);
