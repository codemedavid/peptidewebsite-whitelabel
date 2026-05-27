export default function UnknownTenantPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold">Site not found</h1>
      <p className="text-muted-foreground">
        No storefront is configured for this domain.
      </p>
    </div>
  );
}
