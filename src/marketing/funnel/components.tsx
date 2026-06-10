// ============================================================================
// Reusable presentational primitives for the automation funnel.
// All server components (no hooks). Self-contained Tailwind — no dependency on
// tenant CSS variables, so they render identically on the apex sales site.
// Brand accent: a warm rose gradient (#e94b7d → #b0345e) on a clean white canvas.
// ============================================================================

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

/** Tailwind class for the brand rose gradient, reused across CTAs and small accents. */
export const GRADIENT = "bg-gradient-to-br from-[#e94b7d] via-[#d6396b] to-[#b0345e]";

/** Deeper variant for gradient panels that carry body text — every stop keeps
 *  white (and white/85) text above the WCAG AA 4.5:1 contrast threshold. */
export const GRADIENT_DEEP = "bg-gradient-to-br from-[#c2356a] via-[#a82f5b] to-[#7a1f3d]";

type CtaProps = {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "ghost" | "light";
  size?: "md" | "lg";
  withArrow?: boolean;
  className?: string;
};

/** Every CTA on the funnel routes to /get-started by default. */
export function Cta({
  children,
  href = "/get-started",
  variant = "primary",
  size = "lg",
  withArrow = true,
  className = "",
}: CtaProps) {
  const base =
    "group inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e94b7d] focus-visible:ring-offset-2";
  const sizing = size === "lg" ? "px-7 py-3.5 text-base" : "px-5 py-2.5 text-sm";
  const variants: Record<NonNullable<CtaProps["variant"]>, string> = {
    primary: `${GRADIENT} text-white shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/35 hover:-translate-y-0.5`,
    ghost:
      "bg-white text-zinc-900 ring-1 ring-zinc-200 shadow-sm hover:ring-zinc-300 hover:-translate-y-0.5",
    light:
      "bg-white text-[#b0345e] shadow-lg shadow-black/10 hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-offset-transparent",
  };
  return (
    <Link href={href} className={`${base} ${sizing} ${variants[variant]} ${className}`}>
      {children}
      {withArrow && (
        <ArrowRight
          size={size === "lg" ? 18 : 16}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      )}
    </Link>
  );
}

/** Small uppercase label that sits above a section heading. */
export function Eyebrow({ children, tone = "rose" }: { children: React.ReactNode; tone?: "rose" | "light" }) {
  const cls =
    tone === "light"
      ? "text-white/80"
      : "text-[#c43768]";
  return (
    <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${cls}`}>{children}</span>
  );
}

type HeadingProps = {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "center" | "left";
  tone?: "dark" | "light";
  className?: string;
};

/** Section header: eyebrow + h2 + optional lead paragraph. */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  tone = "dark",
  className = "",
}: HeadingProps) {
  const alignCls = align === "center" ? "mx-auto text-center items-center" : "text-left items-start";
  const titleCls = tone === "light" ? "text-white" : "text-zinc-900";
  const subCls = tone === "light" ? "text-white/85" : "text-zinc-500";
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      {eyebrow && <Eyebrow tone={tone === "light" ? "light" : "rose"}>{eyebrow}</Eyebrow>}
      <h2
        className={`text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl md:text-[2.75rem] ${titleCls}`}
      >
        {title}
      </h2>
      {subtitle && <p className={`text-pretty text-base leading-relaxed sm:text-lg ${subCls}`}>{subtitle}</p>}
    </div>
  );
}

/** Gradient-filled rounded icon tile. */
export function IconBadge({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${GRADIENT} text-white shadow-md shadow-rose-500/20 ${className}`}
    >
      <Icon size={22} strokeWidth={2} />
    </span>
  );
}

/** Soft rose icon tile (used on white cards for a lighter accent). */
export function SoftIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-[#c43768] ring-1 ring-rose-100">
      <Icon size={22} strokeWidth={2} />
    </span>
  );
}

/** Generic white card with hover lift. */
export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li";
}) {
  return (
    <Tag
      className={`rounded-3xl border border-zinc-100 bg-white p-6 shadow-[0_1px_3px_rgba(24,24,27,0.04)] transition-all duration-200 hover:-translate-y-1 hover:border-rose-100 hover:shadow-[0_18px_40px_rgba(176,52,94,0.10)] sm:p-7 ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Standard section wrapper with consistent vertical rhythm + max width. */
export function Section({
  children,
  id,
  className = "",
  width = "default",
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
  width?: "default" | "narrow";
}) {
  const max = width === "narrow" ? "max-w-3xl" : "max-w-6xl";
  return (
    <section id={id} className={`scroll-mt-24 px-5 py-20 sm:px-6 sm:py-24 lg:py-28 ${className}`}>
      <div className={`${max} mx-auto`}>{children}</div>
    </section>
  );
}
