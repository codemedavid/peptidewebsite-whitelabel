"use client";

// The visitor access-code wall. Rendered by the storefront layout (server-side)
// INSTEAD of the store whenever the tenant's gate is on and the visitor doesn't
// hold a valid `tenant.sid` cookie — so the gated store HTML is never sent to an
// unauthenticated browser. White-labeled: logo, brand color and heading all come
// from the tenant. The code is verified server-side (verifyAccessCodeAction); it
// is never shipped to the client, and neither is its hash.
//
// One exception, and it is why this component has two surfaces: the store-admin
// sign-in lives at `#admin`, INSIDE the SPA this wall is replacing. A hash never
// reaches the server, so the layout cannot tell a shopper from an owner on their
// way to the dashboard — which used to force the owner to type the VISITOR code
// before they could type their own email and password. The wall therefore
// resolves the surface here, on the client, where the hash is readable
// (lib/auth/gate-surface.ts), and shows the admin login on `#admin`.
//
// That concedes nothing: the store stays walled on both surfaces, the login is
// protected by its own server-side scrypt check and rate limit, and it shows the
// same store name and logo this wall already shows.

import { useEffect, useState } from "react";
import { imageUrl, LOGO_WIDTH } from "@/lib/media/image-url";
import { useRouter } from "next/navigation";
import { verifyAccessCodeAction } from "@/actions/storefront-gate";
import { resolveGateSurface, type GateSurface } from "@/lib/auth/gate-surface";
import { AdminLogin } from "@/storefront/admin/AdminLogin";

// "checking" = verifying the code; "unlocking" = code accepted, the server is
// re-rendering the store (router.refresh) and this gate is about to unmount. We
// stay in "unlocking" until that swap happens, so the user always sees progress
// instead of the button snapping back to "Enter" with nothing visibly happening.
type Status = "idle" | "checking" | "unlocking";

function Spinner({ color = "#fff" }: { color?: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 15,
        height: 15,
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "sf-gate-spin 0.7s linear infinite",
        verticalAlign: "-2px",
        marginRight: 8,
      }}
    />
  );
}

export function AccessCodeGate({
  storeName,
  logoUrl,
  brandColor,
  heading,
  adminLoginTitle,
  adminLoginSub,
}: {
  storeName: string;
  logoUrl?: string | null;
  brandColor: string;
  heading: string;
  adminLoginTitle?: string;
  adminLoginSub?: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  // Which surface to show. Starts at "wall" because the server has no hash to
  // read and both sides must agree on the first paint; the effect below settles
  // it on mount. Kept in sync with `hashchange` too — the storefront never
  // reloads on a hash change, so a visitor who lands on the wall and then types
  // `#admin` would otherwise keep staring at the code form.
  const [surface, setSurface] = useState<GateSurface>("wall");
  useEffect(() => {
    const sync = () => setSurface(resolveGateSurface(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const busy = status !== "idle";

  // Signed in. The server issued `sf_admin_session`, so re-rendering the layout
  // re-runs evaluateVisitorGate — which exempts a verified admin — and the store
  // replaces this wall with the SPA, still on `#admin`. This must be a
  // router.refresh() and NOT a hard reload: a document load is exactly what
  // middleware kills the admin session on (lib/auth/admin-session-reset.ts), so
  // reloading here would sign the owner straight back out.
  const onAdminSignedIn = () => {
    setStatus("unlocking");
    router.refresh();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setStatus("checking");
    try {
      const res = await verifyAccessCodeAction(code);
      // Only ever trust a genuine `{ ok: true }` — never assume success.
      if ("ok" in res && res.ok) {
        // Cookie is set. Switch to the "unlocking" state and re-render the layout
        // server-side; this component unmounts when the store replaces it. Keep
        // the loading state (do NOT reset) so there's no dead beat in between.
        setStatus("unlocking");
        router.refresh();
        // Safety net: if the refresh somehow doesn't swap the view (slow render,
        // edge cache), force a hard reload so the visitor is never stuck spinning.
        setTimeout(() => window.location.reload(), 4000);
        return;
      }
      const msg = "error" in res ? res.error : "server_error";
      setError(
        msg === "invalid_code"
          ? "That code isn't right. Please try again."
          : msg === "server_error"
            ? "Something went wrong. Please try again."
            : msg,
      );
      setStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  };

  // ── The `#admin` surface: the store owner's / staff sign-in ────────────────
  // Wrapped in `.sf-root` because every `.admin-login` rule in storefront.css is
  // scoped to it — outside that scope the form renders unstyled.
  if (surface === "admin-login") {
    return (
      <div className="sf-root">
        <style>{"@keyframes sf-gate-spin{to{transform:rotate(360deg)}}"}</style>
        {status === "unlocking" ? (
          <div className="admin-login">
            <div className="admin-login__card" style={{ textAlign: "center" }} aria-live="polite">
              <Spinner color={brandColor} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>Opening your dashboard…</span>
            </div>
          </div>
        ) : (
          <AdminLogin
            brand={{ name: storeName, logoUrl, adminLoginTitle, adminLoginSub }}
            onSuccess={onAdminSignedIn}
          />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f7f7f8",
        fontFamily: "var(--font-body, system-ui, -apple-system, Segoe UI, sans-serif)",
      }}
    >
      <style>{"@keyframes sf-gate-spin{to{transform:rotate(360deg)}}"}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          borderRadius: 16,
          padding: "40px 32px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
          textAlign: "center",
        }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl(logoUrl, { width: LOGO_WIDTH })}
            decoding="async"
            alt={storeName}
            style={{ height: 48, width: "auto", margin: "0 auto 20px", objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              height: 48,
              width: 48,
              margin: "0 auto 20px",
              borderRadius: 12,
              background: brandColor,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {storeName?.[0]?.toUpperCase() || "•"}
          </div>
        )}

        {status === "unlocking" ? (
          // Code accepted — the store is loading. Replace the form so the visitor
          // gets unmistakable feedback while the server swaps in the storefront.
          <div style={{ padding: "8px 0 4px" }} aria-live="polite">
            <Spinner color={brandColor} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "#111" }}>Unlocking store…</span>
            <p style={{ fontSize: 13, color: "#888", margin: "10px 0 0" }}>
              One moment while we load {storeName}.
            </p>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: "0 0 6px" }}>{heading}</h1>
            <p style={{ fontSize: 14, color: "#666", margin: "0 0 24px" }}>
              This store is private. Enter your access code to continue.
            </p>

            <form onSubmit={submit}>
              <input
                type="text"
                value={code}
                autoFocus
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Access code"
                disabled={busy}
                onChange={(e) => setCode(e.target.value)}
                aria-label="Access code"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  fontSize: 16,
                  border: error ? "1px solid #e0533d" : "1px solid #d6d6db",
                  borderRadius: 10,
                  outline: "none",
                  marginBottom: error ? 8 : 16,
                }}
              />
              {error ? (
                <div role="alert" style={{ color: "#c0392b", fontSize: 13, marginBottom: 16, textAlign: "left" }}>
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={busy || !code.trim()}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#fff",
                  background: brandColor,
                  border: "none",
                  borderRadius: 10,
                  cursor: busy || !code.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !code.trim() ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {status === "checking" ? (
                  <>
                    <Spinner />
                    Checking…
                  </>
                ) : (
                  "Enter"
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
