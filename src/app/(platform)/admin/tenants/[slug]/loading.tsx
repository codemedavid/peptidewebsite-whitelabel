import { Skeleton } from "@/components/ui/skeleton";

export default function TenantDetailLoading() {
  const tabs = ["Overview", "Features", "Usage", "Orders", "Billing", "Audit log"];

  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading tenant">
      {/* Back link */}
      <Skeleton className="h-7 w-28 mb-3" />

      {/* Tenant header card */}
      <div className="card" style={{ marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Skeleton className="rounded-xl shrink-0" style={{ width: 56, height: 56 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", borderTop: "1px solid var(--border-soft)" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ padding: "14px 20px", borderRight: i < 3 ? "1px solid var(--border-soft)" : "none" }}>
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border-soft)", paddingBottom: 0 }}>
        {tabs.map((t) => (
          <Skeleton key={t} className="h-8 rounded-t-lg" style={{ width: t.length * 8 + 24 }} />
        ))}
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
