import { Skeleton } from "@/components/ui/skeleton";

function FeatureRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px" }}>
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
        <Skeleton className="h-3 w-56" />
      </div>
      <div style={{ width: 160 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <Skeleton className="h-3 w-36" />
    </div>
  );
}

export default function FeaturesLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading feature modules">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>

      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi} className="card mb-4">
          <div className="card-head">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div>
            {Array.from({ length: 5 }).map((_, fi) => (
              <div key={fi} style={{ borderBottom: fi < 4 ? "1px solid var(--border-soft)" : "none" }}>
                <FeatureRow />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
