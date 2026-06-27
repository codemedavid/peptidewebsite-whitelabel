import { Skeleton } from "@/components/ui/skeleton";

export default function TenantIntegrationsLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading integrations">
      <div className="page-head" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-head">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20 rounded-full" />
        </div>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <div style={{ display: "flex", gap: 10 }}>
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-32 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
