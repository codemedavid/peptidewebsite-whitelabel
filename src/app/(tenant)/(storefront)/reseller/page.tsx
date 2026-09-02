import { redirect } from "next/navigation";

/**
 * `/reseller` — a real URL for the reseller portal.
 *
 * The storefront itself is a hash-routed client app (one Server Component render
 * feeding `#merchant`, `#groupbuy`, `#track`, …), so the portal's actual screen
 * lives at `/#merchant` and this route exists to make the address people are
 * given a shareable, typeable one: `https://<tenant>.pepweb.store/reseller`.
 *
 * It deliberately redirects rather than rendering a second copy of the page.
 * A parallel implementation would be a second surface to keep the gate, the
 * pricing and the branding in sync with — exactly the duplication this feature
 * has one engine to avoid. Everything that decides access still happens in the
 * storefront render: entitlement, whether a password is set, and whether THIS
 * request holds a verified reseller session.
 *
 * Note this is not itself an access decision. A visitor who lands here with no
 * session gets the password screen, and — crucially — a page whose catalog was
 * never given any wholesale prices to leak (see wholesaleVisibleTo). When the
 * tenant is not entitled, or the owner has set no password, `#merchant` is not a
 * visible route and the storefront falls back to the home page.
 */
export default function ResellerRoute() {
  redirect("/#merchant");
}
