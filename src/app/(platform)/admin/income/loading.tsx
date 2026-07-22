import { Skeleton } from "@/components/ui/skeleton";

export default function IncomeLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading income analytics">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-8 w-48" />
      </div>

      {/* 4-KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi">
            <Skeleton className="h-3 w-28 mb-3" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* Income chart card */}
      <div className="card mb-4">
        <div className="card-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <div className="card-body">
          <Skeleton className="w-full" style={{ height: 260 }} />
        </div>
      </div>

      {/* Upcoming table + right stack */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="card-body">
              <Skeleton className="h-14 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
