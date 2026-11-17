// The app's input caps vs the server's zod caps (fix: records over a server cap
// were refused at sync and silently lost). Run: npm run test:tracker
import assert from "node:assert/strict";
import { TRACKER_SERVER_CAPS } from "../../src/lib/tracker/caps";
import { INPUT_CAPS, SERVER_CAPS, type CapKey } from "../src/features/tracker/lib/caps";
import { EMPTY_FORM, formToValues, MAX_KG, MAX_NOTE_LEN, MAX_OTHER_LEN } from "../src/features/tracker/components/checkin-model";
import { emptyForm, formFromGuide, formToProtocol, MAX_EVERY, MAX_TIMES } from "../src/features/tracker/lib/protocol-form";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker caps");

test("the app's copy of the server caps matches src/lib/tracker/caps.ts exactly", () => {
  assert.deepEqual({ ...SERVER_CAPS }, { ...TRACKER_SERVER_CAPS });
});

test("every field cap stays within its server cap", () => {
  const pairs: [keyof typeof INPUT_CAPS, CapKey][] = [
    ["name", "name"],
    ["note", "note"],
    ["lot", "lot"],
    ["effect", "effect"],
    ["effects", "effects"],
    ["times", "times"],
    ["waterMl", "waterMl"],
    ["weightKg", "weightKg"],
    ["everyDays", "days"],
  ];
  for (const [input, server] of pairs) assert.ok(INPUT_CAPS[input] <= SERVER_CAPS[server], `${input} ${INPUT_CAPS[input]} > ${SERVER_CAPS[server]}`);
});

test("screens take their limits from INPUT_CAPS", () => {
  assert.equal(MAX_OTHER_LEN, INPUT_CAPS.effect);
  assert.equal(MAX_NOTE_LEN, INPUT_CAPS.note);
  assert.equal(MAX_KG, INPUT_CAPS.weightKg);
  assert.equal(MAX_TIMES, INPUT_CAPS.times);
  assert.equal(MAX_EVERY, INPUT_CAPS.everyDays);
});

test("a full 'Other' box never yields more side effects than the server takes", () => {
  const other = Array.from({ length: 90 }, (_, i) => String.fromCharCode(97 + (i % 26)) + i).join(",").slice(0, INPUT_CAPS.effectsText);
  const r = formToValues({ ...EMPTY_FORM, effects: ["Nausea", "Headache"], other }, "kg");
  assert.ok(r.ok);
  assert.ok(r.values.effects.length <= SERVER_CAPS.effects, `${r.values.effects.length} effects`);
  assert.ok(r.values.effects.every((e) => e.length <= SERVER_CAPS.effect));
  assert.deepEqual(r.values.effects.slice(0, 2), ["Nausea", "Headache"]);
});

test("a protocol from a long store guide is trimmed to the server's name/category caps", () => {
  const base = emptyForm("2026-11-17", "u100_1ml");
  const form = formFromGuide({ name: "N".repeat(200), category: "C".repeat(150), dosage: "250mcg" }, { ...base, times: ["08:00"] });
  const r = formToProtocol(form);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.equal(r.protocol.name.length, SERVER_CAPS.name);
  assert.equal(r.protocol.category?.length, SERVER_CAPS.category);
});

done();
