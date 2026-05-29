import { Skeleton } from "@/components/ui/skeleton";

export default function PlansLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading plans">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80" />
        </div>
      </div>

      {/* 3-KPI row */}
      <div className="grid-3 mb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="kpi">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* 3 plan cards */}
      <div className="grid-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card">
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <div className="divider" />
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-3 w-3/4" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
