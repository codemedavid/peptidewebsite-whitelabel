import { getTenantId } from "@/lib/tenant/headers";
import { withTenant } from "@/lib/db/tenant-client";
import { formatPrice } from "@/lib/utils";
import { isDemoMode, findDemoProduct } from "@/lib/demo/fixtures";
import { requireFeaturePage } from "@/lib/features/entitlements";
import { Gate } from "@/components/Gate";
import { FEATURES } from "@/lib/features/catalog";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenantId = await getTenantId();

  // Route guard: if the catalog feature is off, the route 404s — not just hidden in nav.
  await requireFeaturePage(tenantId, FEATURES.SITE_PRODUCTS);

  // tenant-scoped client forces tenantId; the composite key keeps it unique per tenant.
  // withTenant sets the RLS GUC so this read works under the app role.
  const product = isDemoMode()
    ? findDemoProduct(tenantId, slug)
    : await withTenant(tenantId, (db) =>
        db.product.findFirst({ where: { slug, status: "active" } }),
      );
  if (!product) notFound();

  const images = Array.isArray(product.images) ? (product.images as string[]) : [];
  const meta = (product.metadata ?? {}) as { purity?: string; coaUrl?: string };

  return (
    <div className="container grid gap-10 py-16 md:grid-cols-2">
      <div>
        {images[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={images[0]}
            alt={product.name}
            className="aspect-square w-full rounded-[var(--radius)] object-cover"
          />
        )}
      </div>
      <div>
        <h1 className="font-heading text-3xl font-bold text-foreground">{product.name}</h1>
        <p className="mt-2 text-2xl text-accent">
          {formatPrice(product.priceCents, product.currency)}
        </p>
        {product.description && (
          <p className="mt-6 text-muted-foreground">{product.description}</p>
        )}
        <Gate feature={FEATURES.STORE_PRODUCT_SPECS}>
          <dl className="mt-6 space-y-1 text-sm text-muted-foreground">
            {meta.purity && (
              <div>
                <dt className="inline font-medium">Purity: </dt>
                <dd className="inline">{meta.purity}</dd>
              </div>
            )}
            {meta.coaUrl && (
              <a href={meta.coaUrl} className="text-accent underline">
                View Certificate of Analysis
              </a>
            )}
          </dl>
        </Gate>
        <p className="mt-8 rounded-[var(--radius)] bg-secondary p-3 text-xs text-secondary-foreground">
          For laboratory research use only. Not for human consumption.
        </p>
      </div>
    </div>
  );
}
