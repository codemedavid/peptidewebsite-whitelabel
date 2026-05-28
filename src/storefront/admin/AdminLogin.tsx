"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { ADMIN_AUTH_KEY } from "./authKey";
import { signInStorefrontAdminAction } from "@/actions/storefront-admin";

export { ADMIN_AUTH_KEY };

export function AdminLogin({ brand, onSuccess }: { brand: Brand; onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The password is verified server-side (against branding.config) and, on
  // success, the server issues a signed session cookie. Without it, the save
  // actions reject writes — so the sessionStorage flag below is now only a UI
  // hint for which screen to show, not the actual security boundary.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await signInStorefrontAdminAction(pw);
    setBusy(false);
    if ("ok" in result) {
      try {
        sessionStorage.setItem(ADMIN_AUTH_KEY, "1");
      } catch {
        /* ignore */
      }
      onSuccess();
    } else {
      setError(result.error || "Incorrect password.");
      setTimeout(() => setError(""), 2200);
    }
  };

  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={submit}>
        <div className="admin-login__logo">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} />
          ) : (
            <span className="admin-login__logo-fallback">
              {brand.name?.[0]?.toUpperCase() || "B"}
            </span>
          )}
        </div>
        <h1 className="admin-login__title">{brand.adminLoginTitle || "Admin Access"}</h1>
        <p className="admin-login__sub">
          {brand.adminLoginSub || `Enter the admin password for ${brand.name || "this tenant"}`}
        </p>
        <input
          type="password"
          className={`admin-login__input ${error ? "is-error" : ""}`}
          value={pw}
          placeholder="••••••"
          autoFocus
          onChange={(e) => {
            setPw(e.target.value);
            setError("");
          }}
        />
        <div className="admin-login__error">{error}</div>
        <button type="submit" className="btn btn-primary admin-login__submit" disabled={busy}>
          {busy ? "Checking…" : "Enter Dashboard"}
        </button>
        <div className="admin-login__hint">
          Default password is{" "}
          <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: 4 }}>admin</code>
          .
        </div>
      </form>
    </div>
  );
}
