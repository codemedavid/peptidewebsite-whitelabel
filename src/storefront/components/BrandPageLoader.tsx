// The branded loading screen for ROUTE CHANGES — the mid-visit half of the
// brand splash.
//
// PROPS-LESS ON PURPOSE, and server-renderable on purpose. The two surfaces it
// serves cannot be handed anything: a `loading.tsx` is a Suspense fallback Next
// renders with no arguments, and next/dynamic's `loading` receives only its own
// status flags. Both sit inside the storefront layout, which paints the tenant's
// --splash-* vars and data-splash-design on its root (see lib/storefront/
// brand-loader), so this element inherits every value it needs. No "use client",
// so the server walls and the client SPA fallback share one component.
//
// It reuses the splash's own sf-splash__* class names rather than owning a
// parallel set, so the boot screen and the transition screen cannot drift apart.
// Only the frame differs: .sf-splash-page is inline and scoped to the content
// area, not a fixed full-viewport overlay — a takeover on every tap would be a
// heavier interruption than the navigation it is covering.
//
// The mark renders from CSS (var(--splash-logo) / var(--splash-initials)) rather
// than an <img>, which is what lets this component stay argument-free.

export function BrandPageLoader() {
  return (
    <div className="sf-splash-page" role="status" aria-label="Loading">
      <div className="sf-splash__inner">
        <span className="sf-splash__mark" aria-hidden />

        {/* Both indicators ship; the root's data-splash-design shows the one the
            operator picked. See brandLoaderDesign for why a design without an
            indicator borrows the spinner here. */}
        <span className="sf-splash__ring" aria-hidden />
        <span className="sf-splash__bar" aria-hidden>
          <span className="sf-splash__bar-fill" />
        </span>
      </div>
    </div>
  );
}
