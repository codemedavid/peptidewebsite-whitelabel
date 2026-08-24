import { monogramInitials } from "@/lib/storefront/brand-loader";

/**
 * Logo fallback when a tenant hasn't uploaded one: initials on a brand-colored
 * tile. Reads --brand / --primary-foreground so it re-skins with the theme.
 *
 * The initials rule lives in lib/storefront/brand-loader because the branded
 * page loader draws the same monogram in pure CSS, where this component cannot
 * reach. Sharing one function is what stops a store's header mark and its
 * loading mark from disagreeing.
 */
export function Monogram({ name, className = "" }: { name: string; className?: string }) {
  const initials = monogramInitials(name);

  return (
    <span
      aria-hidden
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[calc(var(--radius)-2px)] text-sm font-bold ${className}`}
      style={{
        backgroundColor: "hsl(var(--brand))",
        color: "hsl(var(--primary-foreground))",
      }}
    >
      {initials}
    </span>
  );
}
