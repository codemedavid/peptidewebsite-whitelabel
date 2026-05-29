import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyticsLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading analytics">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      {/* 4-KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi">
            <Skeleton className="h-3 w-28 mb-3" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>

      {/* Revenue chart card */}
      <div className="card mb-4">
        <div className="card-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
        <div className="card-body">
          <Skeleton className="w-full" style={{ height: 260 }} />
        </div>
      </div>

      {/* Growth chart card */}
      <div className="card">
        <div className="card-head">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="card-body">
          <Skeleton className="w-full" style={{ height: 180 }} />
        </div>
      </div>
    </div>
  );
}
