import { Skeleton } from "@/components/ui/skeleton";

export default function BrandingLoading() {
  return (
    <div className="page-inner" aria-busy="true" aria-label="Loading branding editor">
      {/* Header */}
      <div className="page-head" style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <div className="grid-2" style={{ gap: 20, alignItems: "start" }}>
        {/* Left column — theme + colors + fonts */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-24" /></div>
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-20" /></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-32 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><Skeleton className="h-4 w-16" /></div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-40 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column — live preview */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-head"><Skeleton className="h-4 w-24" /></div>
          <Skeleton className="w-full" style={{ height: 440, borderRadius: 0 }} />
        </div>
      </div>
    </div>
  );
}
