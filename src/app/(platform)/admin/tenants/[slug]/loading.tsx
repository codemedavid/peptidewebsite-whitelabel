import { Skeleton } from "@/components/ui/skeleton";

// Renders INSIDE tenants/[slug]/layout.tsx, so the real header + tab bar are
// already on screen — this only stands in for the tab's content.
export default function TenantDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading tenant">
      {/* Stats strip */}
      <div className="card td-stats-card">
        <div className="td-stats">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="td-stat">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Content area — overview grid skeleton */}
      <div className="grid-2" style={{ gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-32" /></div>
            <div className="card-body">
              <Skeleton className="w-full" style={{ height: 160 }} />
            </div>
          </div>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-28" /></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-24" /></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
