/**
 * Provision the Mama Mica Glow store on ITS OWN Pepweb instance (Mamamica's
 * Supabase, schema "pepweb" — never Pepweb's database). Idempotent: re-running
 * fixes settings without duplicating channels or resetting the password.
 *
 *   set -a; source MamaMicaGlow/.env.mamamica; set +a
 *   MAMAMICA_ADMIN_EMAIL=you@example.com npx tsx scripts/provision-mamamica.ts
 *
 * Creates: the `mamamica` tenant (app community ON, open join), the Supabase
 * login exchange, the welcome DM, and four channels — Announcements (only the
 * team posts), Verified Resellers (only verified resellers see it), Community,
 * Mindanao Buyers Hub.
 * A new admin password is written to MAMAMICA_PASSWORD_FILE (never printed),
 * only when the tenant is first created.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { Prisma, PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password-hash";
import { FEATURES } from "../src/lib/features/catalog";

const SLUG = "mamamica";
const NAME = "Mama Mica Glow";
const PLAN_KEY = "enterprise";

const WELCOME = [
  "Welcome to Mama Mica Glow! 💜 We're so happy you're here.",
  "",
  "📣 Announcements — news, restocks and group buys from the team.",
  "💬 Community — ask questions and chat with other members.",
  "🤝 Verified Resellers — want to resell? Reply here and we'll verify you.",
  "",
  "Questions anytime? Just reply to this message.",
].join("\n");

const CHANNELS = [
  { name: "Announcements", description: "News, restocks and group buys from the Mama Mica team.", emoji: "📣", postRole: "admins", audience: "everyone" },
  { name: "Verified Resellers", description: "Wholesale updates for verified resellers only.", emoji: "🤝", postRole: "everyone", audience: "resellers" },
  { name: "Community", description: "Chat with the team and other members.", emoji: "💬", postRole: "everyone", audience: "everyone" },
  { name: "Mindanao Buyers Hub", description: "Orders, shipping and meetups for buyers in Mindanao.", emoji: "📍", postRole: "everyone", audience: "everyone" },
] as const;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set — see the header of this script.`);
  return v;
}

async function main() {
  const dbUrl = requireEnv("DIRECT_URL");
  if (!new URL(dbUrl).searchParams.get("schema")) throw new Error("Refusing to run: DIRECT_URL has no ?schema= (is this Pepweb's own DB?)");
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const adminEmail = requireEnv("MAMAMICA_ADMIN_EMAIL").toLowerCase();
  const passwordFile = requireEnv("MAMAMICA_PASSWORD_FILE");

  const db = new PrismaClient({ datasourceUrl: dbUrl });
  try {
    const plan = await db.plan.findUniqueOrThrow({ where: { key: PLAN_KEY } });
    const community = await db.feature.findUniqueOrThrow({ where: { key: FEATURES.MOBILE_COMMUNITY } });

    let tenant = await db.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) {
      const password = randomBytes(12).toString("base64url");
      tenant = await db.tenant.create({
        data: { slug: SLUG, name: NAME, status: "active", planId: plan.id, storeAdminEmail: adminEmail, storeAdminPasswordHash: hashPassword(password) },
      });
      writeFileSync(passwordFile, `${adminEmail}\n${password}\n`, { mode: 0o600 });
      console.log(`Admin password written to ${passwordFile}`);
    }
    await db.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: community.id } },
      update: { enabled: true },
      create: { tenantId: tenant.id, featureId: community.id, enabled: true },
    });

    const current = ((await db.branding.findUnique({ where: { tenantId: tenant.id } }))?.config ?? {}) as Record<string, unknown>;
    const config = {
      name: NAME,
      currency: "₱",
      ...current,
      communityJoin: "open",
      communityWelcome: { enabled: true, message: WELCOME },
      supabaseExchange: { url: supabaseUrl, anonKey },
      // Safety bot (Jev): on by default; a re-run keeps whatever the team set since.
      communityModeration: current.communityModeration ?? { enabled: true, muteAfter: 2 },
    } as Prisma.InputJsonValue;
    await db.branding.upsert({ where: { tenantId: tenant.id }, update: { config }, create: { tenantId: tenant.id, config } });

    for (const [i, c] of CHANNELS.entries()) {
      const existing = await db.communityChannel.findFirst({ where: { tenantId: tenant.id, name: c.name } });
      if (existing) {
        await db.communityChannel.update({ where: { id: existing.id }, data: { ...c, sortOrder: i } });
        continue;
      }
      const channel = await db.communityChannel.create({ data: { ...c, tenantId: tenant.id, sortOrder: i } });
      await db.communityTopic.create({
        data: { tenantId: tenant.id, channelId: channel.id, name: "General", emoji: c.emoji, isGeneral: true, createdByKey: "store" },
      });
    }

    const channels = await db.communityChannel.findMany({ where: { tenantId: tenant.id }, orderBy: { sortOrder: "asc" } });
    console.log(`Tenant ${SLUG} ready.`);
    for (const c of channels) console.log(`  ${c.emoji} ${c.name} — posts: ${c.postRole}, visible to: ${c.audience}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
