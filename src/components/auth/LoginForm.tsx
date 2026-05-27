"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/actions/auth";

type Props = {
  /** Where to send the user after a successful login. */
  redirectTo: string;
  title: string;
  subtitle?: string;
};

export function LoginForm({ redirectTo, title, subtitle }: Props) {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signInAction,
    {},
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <h1 className="font-heading text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

        <form action={action} className="mt-6 space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div>
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-[var(--radius)] border border-input bg-background px-3 py-2"
            />
          </div>

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

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
