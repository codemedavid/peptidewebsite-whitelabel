"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { CreateTenantState } from "@/actions/demo";
import { createTenantAction } from "@/actions/onboarding";
import { THEME_PRESETS } from "@/lib/theme/presets";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  defaultPrefixFromName,
  formatOrderNumber,
  normalizeOrderNumberFormat,
  PREFIX_RE,
  MIN_DIGITS,
  MAX_DIGITS,
  type OrderNumberScheme,
} from "@/lib/orders/order-number-format";

// Tenant storefronts live at `<slug>.<ROOT>`. `*.lvh.me` resolves in every
// browser incl. Safari (unlike `*.localhost`); ROOT carries its own dev port.
const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

const PLANS = [
  { key: "starter", name: "Starter" },
  { key: "pro", name: "Pro" },
  { key: "enterprise", name: "Enterprise" },
];

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function NewTenantPage() {
  const [state, action, pending] = useActionState<CreateTenantState, FormData>(
    createTenantAction,
    {},
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [themeId, setThemeId] = useState("clinical-white");

  // Order-number format. Prefix auto-derives from the business name until edited.
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [separator, setSeparator] = useState("-");
  const [scheme, setScheme] = useState<OrderNumberScheme>("sequential");
  const [digits, setDigits] = useState(4);

  const prefixValid = PREFIX_RE.test(prefix);
  const sample = prefixValid
    ? formatOrderNumber(
        normalizeOrderNumberFormat({ prefix, separator, scheme, digits }, name || "Order"),
        scheme === "sequential" ? 1001 : Number("4".repeat(digits)) % 10 ** digits,
      )
    : "—";

  if (state.createdSlug) {
    return (
      <div className="max-w-lg">
        <h1 className="font-heading text-2xl font-bold">Tenant created 🎉</h1>
        <p className="mt-2 text-muted-foreground">
          <strong>{state.createdSlug}</strong> is live — no deploy needed.
        </p>
        <a
          href={`http://${state.createdSlug}.${ROOT}`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ className: "mt-4" })}
        >
          Open the storefront
          <ExternalLink className="h-4 w-4" aria-label="opens in a new tab" />
        </a>
        <div className="mt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-sm text-accent underline underline-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to tenants
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tenants
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-bold">Create tenant</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Name it, pick a plan and theme. It goes live instantly at{" "}
        <code>{slug || "slug"}.{ROOT}</code>.
      </p>

      <form action={action} aria-busy={pending} className="mt-6 space-y-5">
        <div>
          <label htmlFor="tenant-name" className="block text-sm font-medium">
            Business name
          </label>
          <Input
            id="tenant-name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(slugify(e.target.value));
              if (!prefixTouched) setPrefix(defaultPrefixFromName(e.target.value));
            }}
            required
            placeholder="Nordic Peptides"
            className="mt-1"
          />
        </div>

        <div>
          <label htmlFor="tenant-slug" className="block text-sm font-medium">
            Subdomain (slug)
          </label>
          <div className="mt-1 flex items-center">
            <Input
              id="tenant-slug"
              name="slug"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              required
              placeholder="nordic"
              className="rounded-r-none"
            />
            <span className="inline-flex h-10 items-center rounded-r-[var(--radius)] border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
              .{ROOT}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="tenant-plan" className="block text-sm font-medium">
            Plan
          </label>
          <Select id="tenant-plan" name="plan" defaultValue="enterprise" className="mt-1">
            {PLANS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <span id="theme-label" className="block text-sm font-medium">
            Theme
          </span>
          <div className="mt-2 grid grid-cols-3 gap-3" role="group" aria-labelledby="theme-label">
            {Object.values(THEME_PRESETS).map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setThemeId(t.id)}
                aria-pressed={themeId === t.id}
                className={`rounded-[var(--radius)] border p-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  themeId === t.id ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted"
                }`}
              >
                <div className="mb-2 flex gap-1" aria-hidden>
                  <span className="h-4 w-4 rounded-full" style={{ background: `hsl(${t.colors.primary})` }} />
                  <span className="h-4 w-4 rounded-full border border-border" style={{ background: `hsl(${t.colors.background})` }} />
                </div>
                {t.name}
              </button>
            ))}
          </div>
          <input type="hidden" name="themeId" value={themeId} />
        </div>

        {/* ── Order-number format ── */}
        <fieldset className="rounded-[var(--radius)] border border-border p-4">
          <legend className="px-1 text-sm font-medium">Order numbers</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Prefix</span>
              <Input
                name="orderPrefix"
                value={prefix}
                onChange={(e) => {
                  setPrefixTouched(true);
                  setPrefix(e.target.value.toUpperCase());
                }}
                placeholder="ACME"
                aria-invalid={!prefixValid}
                aria-describedby={!prefixValid ? "order-prefix-error" : undefined}
                className="mt-1 uppercase"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Separator</span>
              <Input
                name="orderSeparator"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                maxLength={3}
                placeholder="-"
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Numbering</span>
              <Select
                name="orderScheme"
                value={scheme}
                onChange={(e) => setScheme(e.target.value as OrderNumberScheme)}
                className="mt-1"
              >
                <option value="sequential">Sequential (1001, 1002, …)</option>
                <option value="random">Random</option>
              </Select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Digits</span>
              <Input
                name="orderDigits"
                type="number"
                min={MIN_DIGITS}
                max={MAX_DIGITS}
                value={digits}
                onChange={(e) => setDigits(Number(e.target.value))}
                className="mt-1"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Example: <code className="font-medium text-foreground">{sample}</code>
          </p>
          {!prefixValid && (
            <p id="order-prefix-error" className="mt-1 text-xs text-destructive">
              Prefix must be 2–6 upper-case letters or digits (A–Z, 0–9).
            </p>
          )}
        </fieldset>

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending || !prefixValid}>
          {pending ? "Creating…" : "Create tenant"}
        </Button>
      </form>
    </div>
  );
}
