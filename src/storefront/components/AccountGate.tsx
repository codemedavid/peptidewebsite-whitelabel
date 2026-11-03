"use client";

// The members-only wall: sign in or create an account before the store renders.
// Rendered by the storefront layout (server-side) INSTEAD of the store when the
// owner switched it on (lib/storefront/account-gate.ts) and this request has no
// signed-in customer — so the catalog never reaches a signed-out browser.
//
// The form is the same AuthCard the #account page uses, on the same server
// actions (sign-in/up are rate-limited and verified server-side). Success sets
// the customer cookie; router.refresh() then re-runs the layout, which now lets
// the shopper through and swaps the store in.
//
// Like AccessCodeGate, `#admin` gets the store-admin sign-in instead: the hash
// never reaches the server, so without this the owner would have to create a
// customer account to reach their own dashboard.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { imageUrl, LOGO_WIDTH } from "@/lib/media/image-url";
import { resolveGateSurface, type GateSurface } from "@/lib/auth/gate-surface";
import { AdminLogin } from "@/storefront/admin/AdminLogin";
import { AuthCard, type AuthCardCopy } from "@/storefront/pages/AccountPage";

const WALL_COPY: AuthCardCopy = {
  signin: "This shop is for members. Sign in to see the group buy and place your order.",
  signup: "Create your free account to see the group buy. It takes less than a minute.",
};

type Props = {
  storeName: string;
  logoUrl?: string | null;
  adminLoginTitle?: string;
  adminLoginSub?: string;
};

export function AccountGate({ storeName, logoUrl, adminLoginTitle, adminLoginSub }: Props) {
  const router = useRouter();
  const [entering, setEntering] = useState(false);
  // Starts at "wall" because the server has no hash to read; settled on mount
  // and kept in sync, exactly as AccessCodeGate does.
  const [surface, setSurface] = useState<GateSurface>("wall");
  useEffect(() => {
    const sync = () => setSurface(resolveGateSurface(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Never a hard reload: the layout only needs to re-run with the new cookie,
  // and on #admin a document load is what ends a store-admin session.
  const enter = () => {
    setEntering(true);
    router.refresh();
  };

  if (surface === "admin-login") {
    return (
      <div className="sf-root">
        {entering ? (
          <div className="admin-login">
            <div className="admin-login__card" style={{ textAlign: "center" }} aria-live="polite">
              <span style={{ fontSize: 16, fontWeight: 600 }}>Opening your dashboard…</span>
            </div>
          </div>
        ) : (
          <AdminLogin brand={{ name: storeName, logoUrl, adminLoginTitle, adminLoginSub }} onSuccess={enter} />
        )}
      </div>
    );
  }

  return (
    <div className="sf-root">
      <main className="page acct acct-gate" id="account">
        <div className="page__container">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="acct-gate__logo"
              src={imageUrl(logoUrl, { width: LOGO_WIDTH })}
              alt={storeName}
              decoding="async"
            />
          ) : null}
          {entering ? (
            <p className="acct__loading" aria-live="polite">
              Opening {storeName}…
            </p>
          ) : (
            <AuthCard brand={{ name: storeName }} onAccount={enter} copy={WALL_COPY} />
          )}
        </div>
      </main>
    </div>
  );
}
