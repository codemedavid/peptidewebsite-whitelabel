// Line pictograms for the SHOWCASE layout's trust copy (promise bar, hero trust
// row, closing strip). Which one leads a promise is decided by assuranceIcon()
// from the owner's own words — this file only draws them.
//
// Stroke-only, currentColor, 24px grid: the icon takes whatever colour its
// container sets, so it follows the tenant's --brand-* palette everywhere.

import type { AssuranceIcon } from "@/lib/storefront/showcase-home";

const PATHS: Record<AssuranceIcon, React.ReactNode> = {
  shipping: (
    <>
      <path d="M3 6h11v9H3z" />
      <path d="M14 9h4l3 3v3h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  authentic: (
    <>
      <path d="M6 3h12l3 5-9 13L3 8z" />
      <path d="M3 8h18M9 3l3 5 3-5M12 8v13" />
    </>
  ),
  secure: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  support: <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
  education: (
    <>
      <path d="M3 5.5C5.5 4.5 9 4.5 12 6.5v13c-3-2-6.5-2-9-1z" />
      <path d="M21 5.5c-2.5-1-6-1-9 1v13c3-2 6.5-2 9-1z" />
    </>
  ),
  quality: (
    <>
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
      <path d="M5 19 13 11" />
    </>
  ),
  payment: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  ),
};

export function ShowcaseIcon({ icon, size = 22 }: { icon: AssuranceIcon; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[icon] ?? PATHS.spark}
    </svg>
  );
}

/** The arrow every showcase CTA ends with. */
export function ShowcaseArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
