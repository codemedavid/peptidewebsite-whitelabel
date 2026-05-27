export type ComplianceBannerProps = {
  /** Defaults to the standard research-use-only disclaimer common to this vertical. */
  text?: string;
};

const DEFAULT =
  "All products are sold strictly for laboratory research purposes only. Not for human or animal consumption, diagnostic, or therapeutic use.";

/**
 * Peptide vertical requires a prominent research-use-only disclaimer.
 * Surface it as a fixed-position section in the storefront layout.
 */
export function ComplianceBanner({ text = DEFAULT }: ComplianceBannerProps) {
  return (
    <div className="border-b border-border bg-secondary text-secondary-foreground">
      <p className="container py-2 text-center text-xs">{text}</p>
    </div>
  );
}
