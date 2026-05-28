"use client";

import { useActionState } from "react";
import {
  signInTenantAdminAction,
  type TenantAdminSignInState,
} from "@/actions/tenant-admin";

export function TenantAdminLoginForm() {
  const [state, action, pending] = useActionState<TenantAdminSignInState, FormData>(
    signInTenantAdminAction,
    {},
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <h1 className="font-heading text-2xl font-bold">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the admin password to manage this store.
        </p>

        <form action={action} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              className="mt-1 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2"
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-[var(--radius)] bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
