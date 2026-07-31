"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { signInStoreAdminAction } from "@/actions/storefront-staff";

/**
 * The `#admin` sign-in. EVERY login — the store owner's and every staff
 * member's — requires an email AND a password. There is no password-only form
 * and no default password: the super admin sets the owner's email + password in
 * the tenant settings console, and the owner creates staff with their own.
 *
 * Credentials are verified server-side (both principals against a scrypt hash)
 * and, on success, the server issues a signed session cookie carrying who you
 * are — the sole source of truth for which screen to show. That cookie is
 * deliberately killed on every page refresh (lib/auth/admin-session-reset.ts),
 * so nothing is cached client-side that could outlive it.
 */
export function AdminLogin({ brand, onSuccess }: { brand: Brand; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await signInStoreAdminAction(email, pw);
    setBusy(false);
    if ("ok" in result) {
      onSuccess();
    } else {
      setError(result.error || "Incorrect email or password.");
      setTimeout(() => setError(""), 2600);
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
          {brand.adminLoginSub || `Sign in to manage ${brand.name || "this store"}`}
        </p>
        <input
          type="email"
          className={`admin-login__input ${error ? "is-error" : ""}`}
          value={email}
          placeholder="Email address"
          autoFocus
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
        />
        <input
          type="password"
          className={`admin-login__input ${error ? "is-error" : ""}`}
          value={pw}
          placeholder="Password"
          autoComplete="current-password"
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
          Sign in with the email address and password for this store. Staff use the
          credentials their store owner gave them.
        </div>
      </form>
    </div>
  );
}
