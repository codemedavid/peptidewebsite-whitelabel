// Store app link: https://<tenant-host>/app
//
// The one link a seller shares (or puts in their bio) so a customer gets the
// PepWorld app AND lands in THIS store once it's installed. The app is shared
// by every store, so it can't know the seller from the install alone:
//
//   1. Get the app — the visitor's own platform first (User-Agent); a QR code
//      on a computer so the phone opens this same page.
//   2. Open in the app — pepwebadmin://store/<slug>; the app remembers the
//      store and scopes the customer's sign-in to it.
//   3. Fallback — the store code to type into the app, for anyone whose
//      browser swallowed the deep link.
//
// Laid out like an app-download page (hero + phones, listing facts, what you
// get, install steps), wearing the store's own theme. Renders inside the
// storefront layout's light chrome (tenant colours, fonts, access-code gate),
// never the storefront SPA.

import "./get-app.css";

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Bell, MessageCircle, ReceiptText, ShoppingBag, Tag, Truck } from "lucide-react";

import { getTenantId } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { getEntitlements } from "@/lib/features/entitlements";
import { FEATURES } from "@/lib/features/catalog";
import { isCustomerAppOpen } from "@/lib/mobile/customer-app";
import { isDemoMode } from "@/lib/demo/fixtures";
import { loadCatalogRows } from "@/lib/storefront/storefront-brand";
import { storeDisplayName, storeLogoUrl } from "@/lib/mobile/store-name";
import { APP_LINK_PATH, storeDeepLink } from "@/lib/mobile/store-link";
import { imageUrl } from "@/lib/media/image-url";
import { normalizeDefaultProductImage } from "@/lib/storefront/product-image";
import {
  APP_NAME,
  detectVisitorDevice,
  pickPreviewProducts,
  qrSvgPath,
  resolveAppDownloads,
  type AppDownloads,
  type PreviewProductRow,
  type VisitorDevice,
} from "@/lib/mobile/app-download";

import { AndroidButton, AppStoreButton } from "./_components/StoreButtons";
import { PhoneMockups } from "./_components/PhoneMockups";
import { InstallGuide } from "./_components/InstallGuide";
import { CopyStoreCode } from "./_components/CopyStoreCode";

const PILL_LINK =
  "inline-flex min-h-12 items-center gap-2 rounded-full py-3 text-center bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getTenantContext(await getTenantId());
  const name = storeDisplayName(ctx);
  const logo = storeLogoUrl(ctx);
  const description = `Shop ${name} on the free ${APP_NAME} app. Order in a few taps, follow your delivery and chat with the store.`;
  const ogTitle = `Shop ${name} in the app`;
  return {
    title: "Get the app",
    description,
    robots: { index: false },
    // What Messenger / Viber / WhatsApp show when a seller pastes this link.
    openGraph: {
      title: ogTitle,
      description,
      type: "website",
      ...(logo ? { images: [imageUrl(logo, { width: 600 })] } : {}),
    },
    twitter: { card: "summary", title: ogTitle, description },
  };
}

export default async function StoreAppPage() {
  const tenantId = await getTenantId();
  const [ctx, requestHeaders, entitlements, previewRows] = await Promise.all([
    getTenantContext(tenantId),
    headers(),
    getEntitlements(tenantId),
    loadPreviewRows(tenantId),
  ]);
  const name = storeDisplayName(ctx);
  const logo = storeLogoUrl(ctx);
  const slug = ctx.tenant.slug;
  const brandConfig = (ctx.branding?.config ?? {}) as { defaultProductImage?: unknown };
  const products = pickPreviewProducts(previewRows, normalizeDefaultProductImage(brandConfig.defaultProductImage) ?? null);

  // Stores without App shopping (or App community), both operator-granted,
  // get the "coming soon" page. Chats and pings need the app community too.
  if (!isCustomerAppOpen(entitlements)) return <AppNotYetAvailable storeName={name} logoUrl={logo} />;
  const hasCommunity = entitlements.has(FEATURES.MOBILE_COMMUNITY);

  const device = detectVisitorDevice(requestHeaders.get("user-agent"));
  const downloads = resolveAppDownloads();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const pageUrl = host ? `${proto}://${host}${APP_LINK_PATH}` : null;
  const deepLink = storeDeepLink(slug);

  return (
    <div className="ga-root">
      <div className="container flex max-w-6xl flex-col gap-16 pb-20 sm:gap-24">
        <section
          aria-labelledby="ga-heading"
          className="ga-hero grid items-center gap-12 pt-10 md:grid-cols-[1.05fr_1fr] md:pt-16"
        >
          <div className="flex flex-col items-start gap-6">
            <StoreChip storeName={name} logoUrl={logo} />
            <h1
              id="ga-heading"
              className="font-heading text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
            >
              Shop {name} <span className="ga-accent">from your phone.</span>
            </h1>
            <p className="max-w-md text-lg text-muted-foreground">
              {hasCommunity
                ? "Browse the full catalog, order in a few taps, follow your delivery and chat with us, all in one free app."
                : "Browse the full catalog, order in a few taps and follow every delivery, all in one free app."}
            </p>
            <HeroActions device={device} downloads={downloads} deepLink={deepLink} storeName={name} pageUrl={pageUrl} />
          </div>
          <PhoneMockups storeName={name} logoUrl={logo} products={products} hasCommunity={hasCommunity} />
        </section>

        <AppFacts downloads={downloads} slug={slug} />
        <Features storeName={name} hasCommunity={hasCommunity} />
        <InstallGuide storeName={name} downloads={downloads} device={device} />
        <StoreCodeCard slug={slug} deepLink={device === "desktop" ? null : deepLink} />
      </div>
    </div>
  );
}

/** Catalog rows for the mockup's shop screen. Decorative, so a failed read
 *  draws placeholder tiles instead of failing the page. */
async function loadPreviewRows(tenantId: string): Promise<PreviewProductRow[]> {
  if (isDemoMode()) return [];
  try {
    return await loadCatalogRows(tenantId);
  } catch {
    return [];
  }
}

type BrandProps = { storeName: string; logoUrl: string | null };

function StoreChip({ storeName, logoUrl }: BrandProps) {
  return (
    <p className="ga-store-chip">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl(logoUrl, { width: 108 })} alt="" width={36} height={36} />
      ) : (
        <span className="ga-monogram">{storeName.trim().charAt(0).toUpperCase()}</span>
      )}
      <span className="flex flex-col leading-tight">
        <span className="font-semibold">{storeName}</span>
        <span className="text-xs text-muted-foreground">on the {APP_NAME} app</span>
      </span>
    </p>
  );
}

type HeroActionsProps = {
  device: VisitorDevice;
  downloads: AppDownloads;
  deepLink: string;
  storeName: string;
  pageUrl: string | null;
};

function HeroActions({ device, downloads, deepLink, storeName, pageUrl }: HeroActionsProps) {
  const openInApp = (
    <a href={deepLink} className="ga-link-btn">
      Already installed? Open {storeName} in the app <ArrowRight className="h-4 w-4" aria-hidden />
    </a>
  );

  if (device === "ios") {
    return (
      <div className="flex flex-col items-start gap-4">
        <AppStoreButton href={downloads.iosUrl} />
        {openInApp}
      </div>
    );
  }

  if (device === "android") {
    if (!downloads.androidUrl) return <AndroidSoon storeName={storeName} />;
    return (
      <div className="flex flex-col items-start gap-4">
        <AndroidButton href={downloads.androidUrl} kind={downloads.androidKind} />
        {openInApp}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-5">
      <div className="flex flex-wrap gap-3">
        <AppStoreButton href={downloads.iosUrl} />
        <AndroidButton href={downloads.androidUrl} kind={downloads.androidKind} />
      </div>
      {pageUrl ? <QrPrompt url={pageUrl} /> : null}
    </div>
  );
}

function AndroidSoon({ storeName }: { storeName: string }) {
  return (
    <div className="flex max-w-md flex-col items-start gap-3 rounded-2xl border border-border bg-background p-5">
      <p className="font-semibold">The Android app is almost here</p>
      <p className="text-sm text-muted-foreground">
        {APP_NAME} for Android is in its final testing. Until it&apos;s out, you can order everything on our website.
      </p>
      <Link href="/" className={PILL_LINK}>
        Shop {storeName} now <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function QrPrompt({ url }: { url: string }) {
  const qr = qrSvgPath(url);
  return (
    <div className="ga-qr">
      <svg
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        role="img"
        aria-label="QR code for this page"
        shapeRendering="crispEdges"
      >
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
      <p className="text-sm">
        <span className="block font-semibold">On a computer?</span>
        <span className="text-muted-foreground">
          Point your phone&apos;s camera here to get the app and open our store.
        </span>
      </p>
    </div>
  );
}

function AppFacts({ downloads, slug }: { downloads: AppDownloads; slug: string }) {
  const facts = [
    { label: "Price", value: "Free" },
    { label: "Works on", value: downloads.androidUrl ? "iPhone, iPad & Android" : "iPhone & iPad" },
    { label: "Category", value: "Shopping" },
    { label: "Store code", value: slug },
  ];
  return (
    <dl className="ga-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{fact.label}</dt>
          <dd className="mt-1 break-words font-heading text-lg font-semibold">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Features({ storeName, hasCommunity }: { storeName: string; hasCommunity: boolean }) {
  const ordering = [
    {
      Icon: ShoppingBag,
      title: "Order in a few taps",
      body: `The whole ${storeName} catalog, your cart and checkout in your pocket.`,
    },
    {
      Icon: Truck,
      title: "Follow your delivery",
      body: "See when your order is confirmed, packed and shipped, with the tracking number right there.",
    },
  ];
  // Chats and pings run on the app community; a shopping-only store gets
  // claims it can keep instead.
  const extras = hasCommunity
    ? [
        {
          Icon: MessageCircle,
          title: `Chat with ${storeName}`,
          body: "Questions about an order? Message us directly, no more hunting for our page.",
        },
        {
          Icon: Bell,
          title: "Be first to know",
          body: "Get a ping for order updates, new drops and group buys the moment they open.",
        },
      ]
    : [
        {
          Icon: ReceiptText,
          title: "Every order in one place",
          body: "Sign in once and your past orders, payments and tracking numbers are always there.",
        },
        {
          Icon: Tag,
          title: "Same prices as the website",
          body: `The same ${storeName} catalog, prices and checkout, just faster on your phone.`,
        },
      ];
  const features = [...ordering, ...extras];
  return (
    <section aria-labelledby="ga-features-heading" className="grid gap-10 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
      <div>
        <h2 id="ga-features-heading" className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
          Everything about your order, <span className="ga-accent">in one place.</span>
        </h2>
        <p className="mt-3 max-w-sm text-muted-foreground">
          No more scrolling back through chats for a payment screenshot or a tracking number.
        </p>
      </div>
      <ul className="grid gap-8 sm:grid-cols-2">
        {features.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="ga-feature-icon">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StoreCodeCard({ slug, deepLink }: { slug: string; deepLink: string | null }) {
  return (
    <section aria-labelledby="ga-code-heading" className="ga-code-card">
      <h2 id="ga-code-heading" className="font-heading text-2xl font-bold">
        Opened the app on its own?
      </h2>
      <p className="mx-auto mt-2 max-w-md text-muted-foreground">
        When it asks which store you shop at, enter our store code:
      </p>
      <p className="ga-code mt-4">{slug}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <CopyStoreCode code={slug} />
        {deepLink ? (
          <a href={deepLink} className="ga-copy">
            Open in the app <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
      </div>
    </section>
  );
}

function AppNotYetAvailable({ storeName, logoUrl }: BrandProps) {
  return (
    <div className="ga-root">
      <section
        aria-labelledby="ga-heading"
        className="ga-hero container flex max-w-xl flex-col items-center gap-5 py-20 text-center"
      >
        <StoreChip storeName={storeName} logoUrl={logoUrl} />
        <h1 id="ga-heading" className="font-heading text-4xl font-bold tracking-tight">
          The {storeName} app is coming soon
        </h1>
        <p className="text-muted-foreground">
          Until then, ordering, payment and tracking all work on our website.
        </p>
        <Link href="/" className={PILL_LINK}>
          Shop {storeName} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>
    </div>
  );
}
