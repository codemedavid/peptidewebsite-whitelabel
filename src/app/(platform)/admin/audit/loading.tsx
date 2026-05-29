import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading audit logs">
      <div className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Skeleton className="h-4 w-36" />
        </div>
        <div style={{ padding: "8px 0 12px" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "12px 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <Skeleton className="h-6 w-6 rounded-full" />
                {i < 7 && <div style={{ flex: 1, width: 1, background: "var(--border-soft)", minHeight: 14 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <Skeleton className="h-3.5" style={{ width: `${48 + (i % 4) * 12}%` }} />
                <Skeleton className="h-3 w-14 shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
