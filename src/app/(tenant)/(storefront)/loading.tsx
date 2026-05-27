import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the tenant's home/catalog data resolves (Suspense fallback). */
export default function StorefrontLoading() {
  return (
    <div aria-busy="true" aria-label="Loading storefront">
      {/* Hero placeholder */}
      <section className="bg-background">
        <div className="container grid items-center gap-10 py-20 md:grid-cols-2 md:py-28">
          <div className="space-y-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full max-w-md" />
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-5 w-full max-w-prose" />
            <Skeleton className="h-12 w-40" />
          </div>
          <Skeleton className="hidden aspect-[4/3] w-full md:block" />
        </div>
      </section>

      {/* Catalog grid placeholder */}
      <section className="bg-background">
        <div className="container py-16">
          <Skeleton className="h-9 w-48" />
          <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-[var(--radius)] border border-border bg-card p-4"
              >
                <Skeleton className="mb-4 aspect-square w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
