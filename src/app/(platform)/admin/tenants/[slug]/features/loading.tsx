import { Skeleton } from "@/components/ui/skeleton";

export default function TenantFeaturesLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading tenant features">
      {/* Header */}
      <div className="page-head" style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* 3 feature group cards */}
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi} className="card mb-4">
          <div className="card-head">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div>
            {Array.from({ length: 4 }).map((_, fi) => (
              <div
                key={fi}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderBottom: fi < 3 ? "1px solid var(--border-soft)" : "none",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-4 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-10 rounded-full shrink-0 ml-4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
