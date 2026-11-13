/**
 * One-off: add the QR PH receiving method to the LIVE get-started checkout
 * (`package_payment` PlatformSetting row).
 *
 * The code fallback (PACKAGE_PAYMENT in src/marketing/config.ts) already lists
 * QR PH, but a stored row overrides the fallback, so the live checkout won't
 * show it until it's added to that row. Idempotent: if any method is already
 * tagged qrph:true, nothing is written. When no row exists yet, the code
 * fallback (which includes QR PH) is already what the checkout renders.
 *
 * Prerequisites:
 *   1. `npm run db:push` is NOT needed for this script (no schema change), but
 *      the deploy carrying public/payment/qrph-qr.jpg must be live first, or
 *      the QR image 404s.
 *   2. Run AFTER that deploy:  npx tsx scripts/add-qrph-package-payment.ts
 *
 * The platform-setting read is cached (unstable_cache); a direct DB write can't
 * bust it, so the checkout picks the change up when that cache expires (up to
 * 1 hour) — or immediately after any Save on /admin/payments.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  PACKAGE_PAYMENT_KEY,
  normalizePackagePayment,
  type PackagePaymentMethod,
} from "../src/lib/platform/package-payment";

const prisma = new PrismaClient();

const QRPH_METHOD: Omit<PackagePaymentMethod, "id"> = {
  method: "QR PH",
  account: "Jonina David",
  number: "",
  note: "Scan with any banking or e-wallet app (GCash, Maya, BPI…). A 2% processing fee is added.",
  qrUrl: "/payment/qrph-qr.jpg",
  active: true,
  qrph: true,
};

const names = (ms: PackagePaymentMethod[]) =>
  ms.map((m) => `${m.method}${m.qrph ? " [qrph]" : ""}${m.active ? "" : " (hidden)"}`).join(", ") || "(none)";

async function main() {
  const row = await prisma.platformSetting.findUnique({ where: { key: PACKAGE_PAYMENT_KEY } });
  if (!row) {
    console.log("No stored package_payment row — the code fallback (with QR PH) is already live. Nothing to do.");
    return;
  }

  console.log("── BACKUP: previous package_payment value ──");
  console.log(JSON.stringify(row.value));
  console.log("─────────────────────────────────────────────");

  const config = normalizePackagePayment(row.value);
  console.log(`Before: ${names(config.methods)}`);

  if (config.methods.some((m) => m.qrph)) {
    console.log("A QR PH (qrph:true) method already exists — skipping.");
    return;
  }

  if (config.methods.length >= 12) {
    console.log("Already 12 methods (the max the checkout reads) — remove one in /admin/payments first.");
    process.exitCode = 1;
    return;
  }

  const taken = new Set(config.methods.map((m) => m.id));
  let n = config.methods.length + 1;
  while (taken.has(`pp${n}`)) n++;
  const next = { ...config, methods: [...config.methods, { id: `pp${n}`, ...QRPH_METHOD }] };

  await prisma.platformSetting.update({
    where: { key: PACKAGE_PAYMENT_KEY },
    data: { value: next as unknown as Prisma.InputJsonValue },
  });
  console.log(`After:  ${names(next.methods)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
