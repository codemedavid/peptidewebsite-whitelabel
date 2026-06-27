"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { ADMIN_AUTH_KEY } from "./authKey";
import { signInStoreAdminAction } from "@/actions/storefront-staff";

export { ADMIN_AUTH_KEY };

export function AdminLogin({ brand, onSuccess }: { brand: Brand; onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Credentials are verified server-side (owner against branding.config, staff
  // against their scrypt hash) and, on success, the server issues a signed session
  // cookie carrying who you are. The sessionStorage flag below is only a UI hint
  // for which screen to show, not the security boundary.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await signInStoreAdminAction(username, pw);
    setBusy(false);
    if ("ok" in result) {
      try {
        sessionStorage.setItem(ADMIN_AUTH_KEY, "1");
      } catch {
        /* ignore */
      }
      onSuccess();
    } else {
      setError(result.error || "Incorrect username or password.");
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
          type="text"
          className={`admin-login__input ${error ? "is-error" : ""}`}
          value={username}
          placeholder="Username"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => {
            setUsername(e.target.value);
            setError("");
          }}
        />
        <input
          type="password"
          className={`admin-login__input ${error ? "is-error" : ""}`}
          value={pw}
          placeholder="Password"
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
          Store owners sign in with username{" "}
          <code style={{ background: "rgba(0,0,0,0.05)", padding: "2px 6px", borderRadius: 4 }}>
            owner
          </code>{" "}
          and their admin password. Staff use the username their owner gave them.
        </div>
      </form>
    </div>
  );
}
