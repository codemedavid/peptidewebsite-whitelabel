// Per-protocol share link: https://<tenant-host>/protocols/<key>
//
// Same reason as /p/<slug>: a `#protocols/<key>` fragment never reaches the
// server, so pasted into Messenger/Viber it previews as the bare store name. A
// real route answers the crawler with the protocol's own name, category and
// chart image.
//
// It does NOT render a protocol page of its own. The body is the real
// storefront, handed the protocol key so the Protocols page opens on that
// protocol — the tenant's own design, header and cart, and nothing to drift.
//
// Covered by scripts/test-protocol-link.ts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getTenantId, getTenantIdOrNull } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { resolveEntitledPage } from "@/storefront/visibility";
import { SEED_PROTOCOLS } from "@/storefront/data";
import type { Protocol } from "@/storefront/types";
import { imageUrl } from "@/lib/media/image-url";
import { resolveProtocolImages } from "@/lib/storefront/protocol-images";
import { findProtocolIndexByLinkKey } from "@/lib/storefront/protocol-link";
import { StorefrontHome } from "../../storefront-home";

/** Facebook/WhatsApp render link previews around a 1.91:1 card. */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

type ProtocolsConfig = {
  protocols?: unknown;
  showPageProtocols?: boolean;
  protocolsTitle?: string;
};

/**
 * The tenant's protocols, or null when the Protocols page is not shown — the
 * same two-layer gate (platform entitlement AND owner toggle) the storefront
 * applies, so a link can never reveal a page the owner or operator turned off.
 * An absent list falls back to the seed, exactly as the store does
 * (store.tsx: `brandSeed.protocols ?? SEED_PROTOCOLS`).
 */
async function loadVisibleProtocols(
  tenantId: string,
): Promise<{ protocols: Protocol[]; config: ProtocolsConfig } | null> {
  const [{ branding }, entitlements] = await Promise.all([
    getTenantContext(tenantId),
    getEntitlements(tenantId),
  ]);
  const config = (branding?.config ?? {}) as ProtocolsConfig;
  const visible = resolveEntitledPage(
    entitlements.has(FEATURES.STORE_PROTOCOLS),
    config.showPageProtocols,
  );
  if (!visible) return null;
  const protocols = Array.isArray(config.protocols)
    ? (config.protocols as unknown[]).filter(
        (p): p is Protocol => typeof p === "object" && p !== null,
      )
    : SEED_PROTOCOLS;
  return { protocols, config };
}

/** "Dosage · Frequency · Duration" for a typed protocol; "" for an image guide. */
function protocolSummary(p: Protocol): string {
  if ((p.mode ?? "details") === "image") return "";
  return [p.dosage, p.frequency, p.duration]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenantId = await getTenantIdOrNull();
  if (!tenantId) return { title: "Store not found" };

  const loaded = await loadVisibleProtocols(tenantId);
  if (!loaded) return {};

  const { tenant, settings } = await getTenantContext(tenantId);
  const storeName = settings?.storeName ?? tenant.name;
  const guideTitle = loaded.config.protocolsTitle?.trim() || "Protocol Guide";

  const index = findProtocolIndexByLinkKey(loaded.protocols, decodeURIComponent(slug));
  // A renamed/removed protocol lands on the whole guide, so preview the guide
  // rather than inventing a protocol that isn't there.
  if (index < 0) return { title: guideTitle };

  const protocol = loaded.protocols[index];
  const summary = protocolSummary(protocol);
  const category = String(protocol.category ?? "").trim();
  // An image guide has no typed dosing to quote, so it names the guide instead.
  const description = [category, summary || guideTitle].filter(Boolean).join(" · ");
  const image = resolveProtocolImages(protocol)[0];
  const title = `${protocol.name} · ${storeName}`;

  return {
    // The layout's template appends the store name.
    title: protocol.name,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: storeName,
      images: image
        ? [{ url: imageUrl(image, { width: OG_WIDTH }), width: OG_WIDTH, height: OG_HEIGHT, alt: protocol.name }]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [imageUrl(image, { width: OG_WIDTH })] : undefined,
    },
  };
}

export default async function SharedProtocolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenantId = await getTenantId();

  // The page itself is off (not entitled, or the owner hid it): a link to it is
  // dead. An unknown key on a VISIBLE page still renders the guide — see
  // findProtocolIndexByLinkKey.
  if (!(await loadVisibleProtocols(tenantId))) notFound();

  return <StorefrontHome initialProtocol={decodeURIComponent(slug)} />;
}
