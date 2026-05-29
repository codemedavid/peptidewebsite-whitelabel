import { Skeleton } from "@/components/ui/skeleton";

function CardRows({ count }: { count: number }) {
  return (
    <div className="card-body" style={{ paddingTop: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "10px 0", borderBottom: i < count - 1 ? "1px solid var(--border-soft)" : "none" }}
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

export default function SettingsLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading platform settings">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="grid-2-eq">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-20" /></div>
            <CardRows count={3} />
          </div>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-24" /></div>
            <CardRows count={2} />
          </div>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-28" /></div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < 3 ? "1px solid var(--border-soft)" : "none" }}>
                  <Skeleton className="h-3 w-36" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-20" /></div>
            <CardRows count={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
