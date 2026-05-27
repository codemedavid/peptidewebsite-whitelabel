"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { ADMIN_AUTH_KEY } from "./authKey";

export { ADMIN_AUTH_KEY };

export function AdminLogin({ brand, onSuccess }: { brand: Brand; onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const correct = (brand.adminPassword || "").trim() || "admin";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.trim() === correct) {
      try {
        sessionStorage.setItem(ADMIN_AUTH_KEY, "1");
      } catch {
        /* ignore */
      }
      onSuccess();
    } else {
      setError("Incorrect password.");
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
        <button type="submit" className="btn btn-primary admin-login__submit">
          Enter Dashboard
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
