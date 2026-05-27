import Link from "next/link";
import {
  TITLE_SIZE_CLAMP,
  BODY_SIZE_CLAMP,
  type HeroTypography,
} from "@/lib/theme/tokens";
import { buttonVariants } from "@/components/ui/button";

export type HeroProps = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageUrl?: string;
  /** Optional per-tenant typography; anything unset inherits from the theme. */
  typography?: HeroTypography;
};

export function Hero({
  eyebrow,
  title = "Research-grade peptides",
  subtitle,
  ctaLabel = "Shop catalog",
  ctaHref = "/products",
  imageUrl,
  typography = {},
}: HeroProps) {
  const {
    titleFont,
    titleSize = "xl",
    titleWeight = 700,
    bodyFont,
    bodySize = "lg",
    highlightColor,
    align = "left",
  } = typography;

  // Unset fonts fall back to the theme's heading/body CSS vars; unset highlight
  // falls back to the theme accent. So defaults always inherit from the theme.
  const titleFamily = titleFont ? `'${titleFont}', sans-serif` : "var(--font-heading)";
  const bodyFamily = bodyFont ? `'${bodyFont}', sans-serif` : "var(--font-body)";
  const highlight = highlightColor || "hsl(var(--accent))";
  const centered = align === "center";

  return (
    <section className="relative overflow-hidden bg-background">
      <div
        className="container grid items-center gap-10 py-20 md:grid-cols-2 md:py-28"
        style={{ textAlign: align }}
      >
        <div className={centered ? "md:col-span-2 mx-auto max-w-3xl" : undefined}>
          {eyebrow && (
            <p
              className="mb-3 text-sm font-medium uppercase tracking-widest"
              style={{ color: highlight }}
            >
              {eyebrow}
            </p>
          )}
          <h1
            className="leading-tight text-foreground"
            style={{
              fontFamily: titleFamily,
              fontSize: TITLE_SIZE_CLAMP[titleSize],
              fontWeight: titleWeight,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className={`mt-5 max-w-prose text-muted-foreground ${centered ? "mx-auto" : ""}`}
              style={{ fontFamily: bodyFamily, fontSize: BODY_SIZE_CLAMP[bodySize] }}
            >
              {subtitle}
            </p>
          )}
          <Link href={ctaHref} className={buttonVariants({ size: "lg", className: "mt-8" })}>
            {ctaLabel}
          </Link>
        </div>
        {imageUrl && !centered && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full rounded-[var(--radius)] object-cover"
          />
        )}
      </div>
    </section>
  );
}
