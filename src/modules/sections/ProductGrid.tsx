import Link from "next/link";
import { getTenantId } from "@/lib/tenant/headers";
import { withTenant } from "@/lib/db/tenant-client";
import { formatPrice } from "@/lib/utils";
import { isDemoMode, getDemoProducts } from "@/lib/demo/fixtures";

export type ProductGridProps = {
  title?: string;
  limit?: number;
};

/**
 * Data-driven section: a self-fetching async Server Component.
 * Reads the tenant from request headers and queries via the tenant-scoped
 * client, so it can never see another tenant's products.
 */
export async function ProductGrid({ title = "Catalog", limit = 8 }: ProductGridProps) {
  const products = isDemoMode()
    ? getDemoProducts(await getTenantId()).slice(0, limit)
    : await withTenant(await getTenantId(), (db) =>
        db.product.findMany({
          where: { status: "active", active: true },
          orderBy: { createdAt: "desc" },
          take: limit,
        }),
      );

  if (products.length === 0) return null;

  return (
    <section className="bg-background">
      <div className="container py-16">
        <h2 className="font-heading text-3xl font-bold text-foreground">{title}</h2>
        <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
          {products.map((p) => {
            const images = Array.isArray(p.images) ? (p.images as string[]) : [];
            return (
              <Link
                key={p.id}
                href={p.slug ? `/products/${p.slug}` : "#"}
                className="group rounded-[var(--radius)] border border-border bg-card p-4 transition hover:shadow-lg"
              >
                {images[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[0]}
                    alt={p.name}
                    className="mb-4 aspect-square w-full rounded-[var(--radius)] object-cover"
                  />
                )}
                <h3 className="font-medium text-card-foreground">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(p.priceCents, p.currency)}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
