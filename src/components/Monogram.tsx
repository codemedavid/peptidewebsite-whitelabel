/**
 * Logo fallback when a tenant hasn't uploaded one: initials on a brand-colored
 * tile. Reads --brand / --primary-foreground so it re-skins with the theme.
 */
export function Monogram({ name, className = "" }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[calc(var(--radius)-2px)] text-sm font-bold ${className}`}
      style={{
        backgroundColor: "hsl(var(--brand))",
        color: "hsl(var(--primary-foreground))",
      }}
    >
      {initials || "?"}
    </span>
  );
}
