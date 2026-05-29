import { Skeleton } from "@/components/ui/skeleton";

function SetCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="set-card">
      <div className="set-card-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      <div className="set-card-body" style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-9 w-28 rounded-lg mt-2" />
      </div>
    </div>
  );
}

export default function TenantSettingsLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading tenant settings">
      <div className="page-head" style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SetCardSkeleton rows={2} />
        <SetCardSkeleton rows={3} />
        <SetCardSkeleton rows={2} />
        <div className="set-card" style={{ borderColor: "var(--border-c)" }}>
          <div className="set-card-head">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="set-card-body" style={{ paddingTop: 12 }}>
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
