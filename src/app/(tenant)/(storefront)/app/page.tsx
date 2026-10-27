// Store app link: https://<tenant-host>/app
//
// The one link a seller shares (or puts in their bio) so a customer gets the
// Pepweb app AND lands in THIS store once it's installed. The app is shared by
// every store, so it can't know the seller from the install alone:
//
//   1. Get the app — store download buttons (env-configured).
//   2. Open in the app — pepwebadmin://store/<slug>; the app remembers the
//      store and scopes the customer's sign-in to it.
//   3. Fallback — the store code to type into the app, for anyone who opened
//      this page on a computer or whose browser swallowed the deep link.
//
// Renders inside the storefront layout's light chrome (tenant colours, fonts,
// access-code gate), never the storefront SPA.

import type { Metadata } from "next";

import { getTenantId } from "@/lib/tenant/headers";
import { getTenantContext } from "@/lib/tenant/context";
import { storeDisplayName, storeLogoUrl } from "@/lib/mobile/store-name";
import { storeDeepLink } from "@/lib/mobile/store-link";
import { imageUrl } from "@/lib/media/image-url";

const IOS_URL = process.env.NEXT_PUBLIC_MOBILE_IOS_URL?.trim() || null;
const ANDROID_URL = process.env.NEXT_PUBLIC_MOBILE_ANDROID_URL?.trim() || null;

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await getTenantContext(await getTenantId());
  const name = storeDisplayName(ctx);
  return {
    title: "Get the app",
    description: `Shop ${name} from your phone — browse, order and track in the app.`,
    robots: { index: false },
  };
}

export default async function StoreAppPage() {
  const ctx = await getTenantContext(await getTenantId());
  const name = storeDisplayName(ctx);
  const logo = storeLogoUrl(ctx);
  const slug = ctx.tenant.slug;

  return (
    <main className="container flex max-w-lg flex-col gap-10 py-12 sm:py-16">
      <section aria-labelledby="app-heading" className="flex flex-col items-center gap-4 text-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(logo, { width: 216 })} alt="" width={72} height={72} className="h-[72px] w-[72px] rounded-2xl object-contain" />
        ) : null}
        <h1 id="app-heading" className="font-heading text-3xl font-bold text-brand sm:text-4xl">
          Shop {name} in the app
        </h1>
        <p className="text-muted-foreground">
          Browse, order and follow your deliveries from your phone. Two quick steps.
        </p>
      </section>

      <ol className="flex flex-col gap-4">
        <Step n={1} title="Get the app">
          <div className="flex flex-wrap gap-3">
            <StoreButton href={IOS_URL} label="App Store" />
            <StoreButton href={ANDROID_URL} label="Google Play" />
          </div>
        </Step>

        <Step n={2} title={`Open ${name} in the app`}>
          <p className="text-sm text-muted-foreground">
            Already installed? Tap below on this phone and the app opens straight to {name}.
          </p>
          <a
            href={storeDeepLink(slug)}
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open in the app
          </a>
        </Step>
      </ol>

      <aside className="rounded-lg border border-border p-5 text-center">
        <p className="text-sm text-muted-foreground">On a computer, or the button didn&apos;t work? In the app, tap</p>
        <p className="mt-1 text-sm font-semibold">&ldquo;Add your store&rdquo; and enter</p>
        <p className="mt-3 select-all font-mono text-2xl font-bold tracking-wide text-brand">{slug}</p>
      </aside>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-lg border border-border p-5">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-background"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </li>
  );
}

function StoreButton({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span className="inline-flex h-11 items-center rounded-md border border-dashed border-border px-4 text-sm text-muted-foreground">
        {label} · coming soon
      </span>
    );
  }
  return (
    <a
      href={href}
      rel="noopener"
      className="inline-flex h-11 items-center rounded-md bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
    </a>
  );
}
