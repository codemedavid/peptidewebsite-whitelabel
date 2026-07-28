/**
 * Self-contained test for the onboarding Step 1 contact rework.
 *
 * The owner's rule: Step 1 ("Business information") no longer asks for an email
 * address. WhatsApp takes its place as THE way we reach the client — so it is
 * required, it carries a note explaining we'll message them once the site is
 * done, and it is wired straight through to the Super Admin so the operator can
 * one-tap message them without copying the number anywhere by hand.
 *
 * Three layers are covered:
 *   1. The shared payload schema (src/lib/onboarding/schema.ts) — email optional,
 *      whatsapp required and dialable.
 *   2. The wizard draft model (src/components/onboarding/useOnboardingForm.ts) —
 *      per-step validation and the draft → payload mapping.
 *   3. Structural guards on the wizard UI and the Super Admin onboarding views,
 *      so the field really is gone from the form and the number really does
 *      surface as a click-to-chat link for the operator.
 *
 *   npm run test:onboarding-contact
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { onboardingSchema } from "../src/lib/onboarding/schema";
import {
  validateStep,
  draftToPayload,
  INITIAL_DRAFT,
  type Draft,
} from "../src/components/onboarding/useOnboardingForm";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Slice a source file between two markers, so a guard can't pass on a match
 *  that lives in a completely different component. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `marker not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
}

/** A minimal payload the schema should accept — deliberately no `email` key. */
const basePayload = {
  businessName: "Glow Manila",
  whatsapp: "639171234567",
  themeId: "clinical-white",
  orderDestination: "whatsapp",
  packageKey: "starter",
  termsAccepted: true,
};

console.log("\nOnboarding Step 1 — WhatsApp replaces email as the contact channel\n");

// ────────────────────────────── shared schema ───────────────────────────────
console.log("onboardingSchema");

check("accepts a submission that has no email address at all", () => {
  const r = onboardingSchema.safeParse(basePayload);
  assert.ok(r.success, `expected parse to succeed, got ${r.success ? "" : JSON.stringify(r.error.issues)}`);
});

check("rejects a submission with no WhatsApp number", () => {
  const { whatsapp, ...noWa } = basePayload;
  void whatsapp;
  assert.equal(onboardingSchema.safeParse(noWa).success, false);
  assert.equal(onboardingSchema.safeParse({ ...basePayload, whatsapp: "   " }).success, false);
});

check("rejects a WhatsApp number that is too short to dial", () => {
  assert.equal(onboardingSchema.safeParse({ ...basePayload, whatsapp: "12345" }).success, false);
});

check("accepts a human-formatted WhatsApp number (+, spaces, dashes)", () => {
  const r = onboardingSchema.safeParse({ ...basePayload, whatsapp: "+63 917 123-4567" });
  assert.ok(r.success, "a formatted international number should be accepted");
});

// ───────────────────────────── wizard draft model ───────────────────────────
console.log("\nvalidateStep / draftToPayload");

const draftWith = (patch: Partial<Draft>): Draft => ({ ...INITIAL_DRAFT, ...patch });

check("step 1 never reports an email error — the field no longer exists", () => {
  const e = validateStep(0, draftWith({ businessName: "Glow Manila", whatsapp: "639171234567" }));
  assert.ok(!("email" in e), `unexpected email error: ${JSON.stringify(e)}`);
});

check("step 1 blocks on a missing WhatsApp number", () => {
  const e = validateStep(0, draftWith({ businessName: "Glow Manila", whatsapp: "" }));
  assert.ok(e.whatsapp, "a blank WhatsApp number should block the step");
});

check("step 1 blocks on a WhatsApp number that is too short", () => {
  const e = validateStep(0, draftWith({ businessName: "Glow Manila", whatsapp: "12345" }));
  assert.ok(e.whatsapp, "a 5-digit number should block the step");
});

check("step 1 passes with a business name and a dialable WhatsApp number", () => {
  const e = validateStep(0, draftWith({ businessName: "Glow Manila", whatsapp: "+63 917 123 4567" }));
  assert.deepEqual(e, {});
});

check("draftToPayload no longer sends an email field", () => {
  const payload = draftToPayload(draftWith({ businessName: "Glow Manila", whatsapp: "639171234567" }));
  assert.ok(!("email" in payload), "the payload should not carry an email key");
});

check("draftToPayload passes the WhatsApp number straight through", () => {
  const payload = draftToPayload(draftWith({ businessName: "Glow Manila", whatsapp: " 639171234567 " }));
  assert.equal(payload.whatsapp, "639171234567");
});

// ──────────────────────────────── wizard UI ─────────────────────────────────
console.log("\nWizard UI");

const stepsSrc = read("src/components/onboarding/steps/index.tsx");
const businessStep = between(stepsSrc, "export function BusinessStep", "export function BrandingStep");

check("BusinessStep no longer renders the email address field", () => {
  assert.ok(!businessStep.includes("biz-email"), "the email input is still rendered in Step 1");
  assert.ok(!/label="Email address"/.test(businessStep), 'the "Email address" label is still in Step 1');
});

check("BusinessStep marks WhatsApp as required and surfaces its error", () => {
  const field = between(businessStep, 'htmlFor="biz-wa"', "</Field>");
  assert.ok(/\brequired\b/.test(field), "the WhatsApp field is not marked required");
  assert.ok(field.includes("errors.whatsapp"), "the WhatsApp field does not show its validation error");
});

check("BusinessStep explains that WhatsApp is how we reach them when the site is done", () => {
  assert.ok(
    /once your website is ready/i.test(businessStep),
    "the WhatsApp note about being contacted once the website is done is missing",
  );
});

const wizardSrc = read("src/components/onboarding/OnboardingWizard.tsx");

check("the success screen promises a WhatsApp message, not an email", () => {
  assert.ok(!wizardSrc.includes("draft.email"), "the success screen still reads draft.email");
  assert.ok(/draft\.whatsapp/.test(wizardSrc), "the success screen should reference the WhatsApp number");
});

// ───────────────────────── Super Admin quick-contact ────────────────────────
console.log("\nSuper Admin — one-tap contact");

const typesSrc = read("src/lib/admin/onboarding-types.ts");
const dataSrc = read("src/lib/admin/onboarding-data.ts");
const listSrc = read("src/components/admin/pages/OnboardingList.tsx");
const detailSrc = read("src/components/admin/pages/OnboardingDetail.tsx");

check("OnboardingSummary carries the WhatsApp number so the list can show it", () => {
  const summary = between(typesSrc, "export type OnboardingSummary", "export type OnboardingDetailView");
  assert.ok(/whatsapp:\s*string/.test(summary), "OnboardingSummary has no whatsapp field");
});

check("both the DB and demo summary mappers populate whatsapp", () => {
  const fromDb = between(dataSrc, "function summaryFromDb", "function detailFromDb");
  assert.ok(/whatsapp:/.test(fromDb), "summaryFromDb does not map whatsapp");
  const fromDemo = between(dataSrc, "function summaryFromDemo", "function detailFromDemo");
  assert.ok(/whatsapp:/.test(fromDemo), "summaryFromDemo does not map whatsapp");
});

check("the onboarding list is searchable by WhatsApp number", () => {
  assert.ok(/s\.whatsapp/.test(listSrc), "the list search does not look at the WhatsApp number");
});

check("the submission detail renders a wa.me click-to-chat link", () => {
  assert.ok(detailSrc.includes("buildWaLink"), "the detail view does not build a wa.me link");
  assert.ok(/submission\.whatsapp/.test(detailSrc), "the detail view does not read submission.whatsapp");
});

check("the submission detail header leads with WhatsApp, email only as a legacy fallback", () => {
  const header = between(detailSrc, "{submission.url}", "Submitted {humanDate");
  assert.ok(
    /submission\.whatsapp\s*\?/.test(header),
    "the header does not branch on the WhatsApp number",
  );
  const wa = header.indexOf("submission.whatsapp");
  const mail = header.indexOf("submission.email");
  assert.ok(wa >= 0, "the header does not show the WhatsApp number at all");
  assert.ok(mail < 0 || wa < mail, "the header still leads with the email address");
});

// ─────────────────────────────────── result ─────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
