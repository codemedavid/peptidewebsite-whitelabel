import { Skeleton } from "@/components/ui/skeleton";

/** Streamed fallback while the product row resolves. */
export default function ProductLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading product"
      className="container grid gap-10 py-16 md:grid-cols-2"
    >
      <Skeleton className="aspect-square w-full rounded-[var(--radius)]" />
      <div className="space-y-4">
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-8 h-10 w-40" />
      </div>
    </div>
  );
}
