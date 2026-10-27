/**
 * ONE-SHOT tenant config for `mnm-pepsabuy` (2026-10-27). Owner-requested
 * payment setup: the store had never saved its payment methods, so checkout
 * was showing the stock SEED defaults. Those are replaced with the owner's
 * own GoTyme QRs:
 *
 *   • two checkout methods (group-buy + on-hand orders)
 *   • one Paid Access join-fee account (`paidAccess: true`) — shown only on a
 *     group buy's join payment step, never at checkout
 *
 * QR images are uploaded to the tenant's ImageKit folder. Re-running keeps
 * an already-uploaded QR (matched by method id) instead of uploading again.
 *
 *   npx tsx --env-file=.env scripts/configure-mnm-payment-methods.ts <checkoutQr1> <checkoutQr2> <paidAccessQr>
 */
import { readFile } from "node:fs/promises";
import { PrismaClient, Prisma } from "@prisma/client";
import { uploadTenantMedia } from "../src/lib/imagekit/server";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const SLUG = "mnm-pepsabuy";

type MethodSpec = {
  id: string;
  name: string;
  account: string;
  number: string;
  paidAccess: boolean;
  qrPath: string;
};

function specs(paths: string[]): MethodSpec[] {
  const [checkout1, checkout2, joinFee] = paths;
  if (!checkout1 || !checkout2 || !joinFee) {
    throw new Error("usage: configure-mnm-payment-methods.ts <checkoutQr1> <checkoutQr2> <paidAccessQr>");
  }
  return [
    { id: "mnm-gotyme-albano", name: "GoTyme · Mae Karille Albano", account: "MAE KARILLE ALBANO", number: "•••• 9262", paidAccess: false, qrPath: checkout1 },
    { id: "mnm-gotyme-instapay", name: "GoTyme · InstaPay QR", account: "", number: "Scan the InstaPay QR", paidAccess: false, qrPath: checkout2 },
    { id: "mnm-gotyme-join-fee", name: "GoTyme · Noemi Lape", account: "NOEMI LAPE", number: "•••• 5988", paidAccess: true, qrPath: joinFee },
  ];
}

async function qrUrl(tenantId: string, spec: MethodSpec, existing: Record<string, unknown>[]): Promise<string> {
  const prior = existing.find((m) => m.id === spec.id);
  if (prior && typeof prior.qrImage === "string" && prior.qrImage) return prior.qrImage;
  const uploaded = await uploadTenantMedia({
    tenantId,
    file: await readFile(spec.qrPath),
    fileName: `${spec.id}.jpg`,
    tags: ["payment-qr"],
  });
  return uploaded.url;
}

const summary = (methods: unknown) =>
  JSON.stringify(
    (Array.isArray(methods) ? methods : []).map((m) => `${m.name}${m.paidAccess ? " [join fee]" : ""}${m.active ? "" : " (off)"}`),
  );

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`tenant "${SLUG}" not found`);

  const branding = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  const config = (branding?.config ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(config.paymentMethods) ? (config.paymentMethods as Record<string, unknown>[]) : [];
  console.log(`BEFORE ${SLUG}: ${existing.length ? summary(existing) : "none saved (checkout shows SEED defaults)"}`);

  const paymentMethods = [];
  for (const [i, spec] of specs(process.argv.slice(2)).entries()) {
    paymentMethods.push({
      id: spec.id,
      name: spec.name,
      account: spec.account,
      number: spec.number,
      qrImage: await qrUrl(tenant.id, spec, existing),
      order: i + 1,
      active: true,
      ...(spec.paidAccess ? { paidAccess: true } : {}),
    });
  }

  await prisma.branding.update({
    where: { tenantId: tenant.id },
    data: { config: { ...config, paymentMethods } as Prisma.InputJsonValue },
  });

  const after = await prisma.branding.findUnique({ where: { tenantId: tenant.id }, select: { config: true } });
  console.log(`AFTER  ${SLUG}: ${summary((after?.config as Record<string, unknown>)?.paymentMethods)}`);
  for (const m of paymentMethods) console.log(`  ${m.id}: ${m.qrImage}`);
  console.log("done — the storefront caches branding: press Save on any store-admin screen (or redeploy) to see it live.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
