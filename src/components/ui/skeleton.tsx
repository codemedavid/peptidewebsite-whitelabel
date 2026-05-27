import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Pulses with `animate-pulse` (auto-stilled under
 * prefers-reduced-motion via globals.css) and tints with the theme's --muted.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-[var(--radius)] bg-muted", className)}
      {...props}
    />
  );
}
