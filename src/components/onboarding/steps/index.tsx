"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Minus,
  Gem,
  ShoppingBag,
  Moon,
  Wand2,
  MessageCircle,
  MessagesSquare,
  Send,
  Mail,
  Plus,
  Trash2,
  Check,
  Truck,
  HelpCircle,
  Calculator,
  BookOpen,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  type Draft,
  emptyProduct,
  THEME_STYLE_OPTIONS,
  ORDER_DESTINATION_OPTIONS,
  PAYMENT_PRESETS,
  STARTER_FEATURE_OPTIONS,
  STARTER_FEATURE_LIMIT,
  STARTER_EXTRA_FEATURE_PRICE_CENTS,
} from "../useOnboardingForm";
import {
  STARTER_FEATURE_LABELS,
  type StarterFeatureKey,
} from "@/lib/onboarding/schema";
import { SingleUpload, MultiUpload } from "../uploads";
import { checkoutQuote } from "@/lib/onboarding/pricing";
import { QRPH_FEE_LABEL } from "@/lib/storefront/payment-fee";
import { baseStoreSlug, storeRootDomain } from "@/lib/onboarding/store-slug";
import { previewStoreSlugAction } from "@/actions/public-onboarding";
import { packageLabel, type Package } from "@/marketing/config";
import {
  visiblePackagePaymentMethods,
  type PackagePaymentConfig,
} from "@/lib/platform/package-payment";

export type StepProps = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: Record<string, string>;
  // Operator-managed receiving accounts for the checkout step (Super Admin →
  // Checkout Payments). Only CheckoutStep reads it.
  packagePayment: PackagePaymentConfig;
  // Operator-edited plan pricing/features (Super Admin → Plans & Billing).
  // Only PackageStep reads it.
  packages: Package[];
};

const ICONS: Record<string, LucideIcon> = {
  Minus,
  Gem,
  ShoppingBag,
  Moon,
  Wand2,
  MessageCircle,
  MessagesSquare,
  Send,
  Mail,
  Truck,
  HelpCircle,
  Calculator,
  BookOpen,
  ShieldCheck,
};

/** Format integer centavos as a peso string, e.g. 150000 → "₱1,500". */
function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString("en-PH")}`;
}

/* ---------- shared field helpers ---------- */
function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mk-field">
      <label className="mk-label" htmlFor={htmlFor}>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mk-hint">{hint}</p>}
      {error && <p className="mk-error">{error}</p>}
    </div>
  );
}

function Text({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  error,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      className={`mk-input${error ? " mk-input-error" : ""}`}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ============================================================ Step 1 */
const SLUG_PREVIEW_DEBOUNCE_MS = 400;

/** Live "your store address" line: an instant client-side guess, then the slug
 *  the server would actually assign (taken + reserved names accounted for). */
function StoreAddressPreview({ name }: { name: string }) {
  const root = storeRootDomain();
  const clean = name.trim();
  const [server, setServer] = useState<{ name: string; slug: string } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    if (clean.length < 2) return;
    const req = ++latest.current;
    const timer = setTimeout(() => {
      previewStoreSlugAction(clean)
        .then((res) => {
          if (req === latest.current && "slug" in res) setServer({ name: clean, slug: res.slug });
        })
        .catch(() => {
          /* the instant guess stays on screen */
        });
    }, SLUG_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [clean]);

  if (clean.length < 2) return null;
  const slug = server?.name === clean ? server.slug : baseStoreSlug(clean);
  return (
    <p className="mk-hint" aria-live="polite" style={{ marginTop: -6, marginBottom: 14 }}>
      Your store address: <b style={{ color: "var(--ink)" }}>{slug}.{root}</b>
    </p>
  );
}

export function BusinessStep({ draft, update, errors }: StepProps) {
  return (
    <div>
      <Field label="Business name" htmlFor="biz-name" required error={errors.businessName}>
        <Text id="biz-name" value={draft.businessName} error={!!errors.businessName}
          placeholder="e.g. Glow Manila" onChange={(v) => update({ businessName: v })} />
      </Field>
      <StoreAddressPreview name={draft.businessName} />
      <Field label="WhatsApp number" htmlFor="biz-wa" required error={errors.whatsapp}
        hint="We'll message you here about your setup, and once your website is ready.">
        <Text id="biz-wa" value={draft.whatsapp} error={!!errors.whatsapp}
          placeholder="0917 123 4567" onChange={(v) => update({ whatsapp: v })} />
      </Field>
      <Field label="Contact person" htmlFor="biz-contact" hint="Optional">
        <Text id="biz-contact" value={draft.contactPerson} placeholder="Your name"
          onChange={(v) => update({ contactPerson: v })} />
      </Field>
      <Field label="Short description" htmlFor="biz-desc" hint="Optional — one or two lines we can use on your homepage.">
        <textarea id="biz-desc" className="mk-textarea" value={draft.description}
          placeholder="What you sell and what makes you special."
          onChange={(e) => update({ description: e.target.value })} />
      </Field>
      {/* Honeypot — hidden from real users; bots fill it and get rejected. */}
      <input type="text" tabIndex={-1} autoComplete="off" className="mk-sr" aria-hidden="true"
        value={draft.website} onChange={(e) => update({ website: e.target.value })} />
    </div>
  );
}

/* ============================================================ Details: branding */
export function BrandingStep({ draft, update }: StepProps) {
  return (
    <div>
      <Field label="Preferred theme style">
        <div className="mk-choices">
          {THEME_STYLE_OPTIONS.map((o) => {
            const Icon = ICONS[o.icon] ?? Wand2;
            const selected = draft.themeStyle === o.id;
            return (
              <button key={o.id} type="button" className="mk-choice" data-selected={selected}
                onClick={() => update({ themeStyle: o.id, themeId: o.themeId })}>
                <span className="mk-choice-ic"><Icon size={20} /></span>
                <span>
                  <b>{o.label}</b>
                  <small>{o.desc}</small>
                </span>
                {selected && <Check className="mk-choice-check" size={20} />}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="mk-field-row">
        <Field label="Primary color">
          <div className="mk-swatch-row">
            <input type="color" className="mk-swatch" aria-label="Primary color"
              value={draft.primaryColor} onChange={(e) => update({ primaryColor: e.target.value })} />
            <input className="mk-input mk-color-text" value={draft.primaryColor}
              onChange={(e) => update({ primaryColor: e.target.value })} />
          </div>
        </Field>
        <Field label="Secondary color">
          <div className="mk-swatch-row">
            <input type="color" className="mk-swatch" aria-label="Secondary color"
              value={draft.secondaryColor} onChange={(e) => update({ secondaryColor: e.target.value })} />
            <input className="mk-input mk-color-text" value={draft.secondaryColor}
              onChange={(e) => update({ secondaryColor: e.target.value })} />
          </div>
        </Field>
      </div>

      <Field label="Logo" hint="Square works best. Optional — we can design one with you.">
        <SingleUpload value={draft.logoUrl} kind="logo" label="Upload logo"
          onChange={(url) => update({ logoUrl: url })} />
      </Field>
      <Field label="Inspiration images" hint="Screenshots of websites or styles you love.">
        <MultiUpload value={draft.inspirationUrls} kind="inspiration" max={6}
          onChange={(urls) => update({ inspirationUrls: urls })} />
      </Field>
      <Field label="Website inspirations or pegs" htmlFor="insp-notes">
        <textarea id="insp-notes" className="mk-textarea" value={draft.inspirationNotes}
          placeholder="Paste links or describe the look and feel you want."
          onChange={(e) => update({ inspirationNotes: e.target.value })} />
      </Field>
    </div>
  );
}

/* ============================================================ Details: products */
export function ProductsStep({ draft, update, errors }: StepProps) {
  const set = (i: number, patch: Partial<Draft["products"][number]>) =>
    update({ products: draft.products.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const remove = (i: number) => update({ products: draft.products.filter((_, j) => j !== i) });

  return (
    <div>
      {draft.products.map((p, i) => (
        <div className="mk-repeat" key={i}>
          <div className="mk-repeat-head">
            <b>Product {i + 1}</b>
            {draft.products.length > 1 && (
              <button type="button" className="mk-icon-btn" onClick={() => remove(i)}>
                <Trash2 size={15} /> Remove
              </button>
            )}
          </div>
          <div className="mk-field-row">
            <Field label="Product name" htmlFor={`p-name-${i}`}>
              <Text id={`p-name-${i}`} value={p.name} placeholder="e.g. Vitamin C Serum"
                onChange={(v) => set(i, { name: v })} />
            </Field>
            <Field label="Price (₱)" htmlFor={`p-price-${i}`} error={errors[`product-${i}`]}>
              <input id={`p-price-${i}`} type="number" min={0} step="0.01"
                className={`mk-input${errors[`product-${i}`] ? " mk-input-error" : ""}`}
                value={p.price} placeholder="0.00" onChange={(e) => set(i, { price: e.target.value })} />
            </Field>
          </div>
          <div className="mk-field-row">
            <Field label="Category" htmlFor={`p-cat-${i}`}>
              <Text id={`p-cat-${i}`} value={p.category} placeholder="e.g. Skincare"
                onChange={(v) => set(i, { category: v })} />
            </Field>
            <Field label="Product image">
              <SingleUpload value={p.imageUrl} kind="product" label="Upload photo"
                onChange={(url) => set(i, { imageUrl: url })} />
            </Field>
          </div>
          <Field label="Description" htmlFor={`p-desc-${i}`}>
            <textarea id={`p-desc-${i}`} className="mk-textarea" value={p.description}
              placeholder="Short product description." onChange={(e) => set(i, { description: e.target.value })} />
          </Field>
        </div>
      ))}
      <button type="button" className="mk-btn mk-btn-soft"
        onClick={() => update({ products: [...draft.products, emptyProduct()] })}>
        <Plus size={16} /> Add Another Product
      </button>
      <p className="mk-hint" style={{ marginTop: 12 }}>
        No products yet? You can skip this and add them later from your dashboard.
      </p>
    </div>
  );
}

/* ============================================================ Details: orders */
export function OrdersStep({ draft, update, errors }: StepProps) {
  const active = ORDER_DESTINATION_OPTIONS.find((o) => o.id === draft.orderDestination)!;
  const waPreview =
    draft.orderDestination === "whatsapp" && draft.orderDestinationValue.replace(/\D/g, "");
  return (
    <div>
      <Field label="Where should customer orders go?">
        <div className="mk-choices">
          {ORDER_DESTINATION_OPTIONS.map((o) => {
            const Icon = ICONS[o.icon] ?? MessageCircle;
            const selected = draft.orderDestination === o.id;
            return (
              <button key={o.id} type="button" className="mk-choice" data-selected={selected}
                onClick={() => update({ orderDestination: o.id })}>
                <span className="mk-choice-ic"><Icon size={20} /></span>
                <span>
                  <b>{o.label}</b>
                  <small>{o.desc}</small>
                </span>
                {selected && <Check className="mk-choice-check" size={20} />}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label={`${active.label} ${active.id === "email" ? "address" : "destination"}`}
        htmlFor="order-dest" required hint={active.hint} error={errors.orderDestinationValue}>
        <Text id="order-dest" value={draft.orderDestinationValue} error={!!errors.orderDestinationValue}
          placeholder={active.placeholder} onChange={(v) => update({ orderDestinationValue: v })} />
      </Field>
      {waPreview && (
        <p className="mk-hint">
          Your WhatsApp order link: <code>https://wa.me/{waPreview}</code>
        </p>
      )}
    </div>
  );
}

/* ============================================================ Details: payments */
export function PaymentsStep({ draft, update }: StepProps) {
  const byName = new Map(draft.paymentMethods.map((m) => [m.name, m]));
  const toggle = (name: string) => {
    if (byName.has(name)) update({ paymentMethods: draft.paymentMethods.filter((m) => m.name !== name) });
    else update({ paymentMethods: [...draft.paymentMethods, { name, account: "", number: "", qrUrl: "", instructions: "" }] });
  };
  const patch = (name: string, p: Partial<Draft["paymentMethods"][number]>) =>
    update({ paymentMethods: draft.paymentMethods.map((m) => (m.name === name ? { ...m, ...p } : m)) });

  return (
    <div>
      <p className="mk-step-sub" style={{ marginTop: -10 }}>
        Pick the methods your customers can pay with. Add account details and a QR code for each.
      </p>
      <div className="mk-choices">
        {PAYMENT_PRESETS.map((name) => {
          const on = byName.has(name);
          const m = byName.get(name);
          return (
            <div key={name} className="mk-choice" data-selected={on} style={{ display: "block", cursor: "default" }}>
              <label className="mk-check" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                <b style={{ color: "var(--ink)" }}>{name}</b>
              </label>
              {on && m && (
                <div style={{ marginTop: 14 }}>
                  <div className="mk-field-row">
                    <Field label="Account name" htmlFor={`pm-acc-${name}`}>
                      <Text id={`pm-acc-${name}`} value={m.account} placeholder="Account holder"
                        onChange={(v) => patch(name, { account: v })} />
                    </Field>
                    <Field label="Account number" htmlFor={`pm-num-${name}`}>
                      <Text id={`pm-num-${name}`} value={m.number} placeholder="0917 000 0000"
                        onChange={(v) => patch(name, { number: v })} />
                    </Field>
                  </div>
                  <Field label="Payment instructions" htmlFor={`pm-ins-${name}`}>
                    <textarea id={`pm-ins-${name}`} className="mk-textarea" value={m.instructions}
                      placeholder="e.g. Send payment and screenshot the receipt."
                      onChange={(e) => patch(name, { instructions: e.target.value })} />
                  </Field>
                  <Field label="QR code" hint="Optional — upload your payment QR.">
                    <SingleUpload value={m.qrUrl} kind="payment-qr" label="Upload QR"
                      onChange={(url) => patch(name, { qrUrl: url })} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================ Package */
export function PackageStep({ draft, update, errors, packages }: StepProps) {
  const isStarter = draft.packageKey === "starter";
  const picked = draft.selectedFeatures;
  const extras = Math.max(0, picked.length - STARTER_FEATURE_LIMIT);
  const addonCents = extras * STARTER_EXTRA_FEATURE_PRICE_CENTS;
  const yearly = draft.billingCycle === "yearly";
  // Headline for the Yearly tab: the biggest saving on offer across the tiers.
  const bestSavingPercent = packages.reduce((best, p) => Math.max(best, p.yearlySavingsPercent), 0);
  const business = packages.find((p) => p.key === "pro");

  function toggleFeature(id: StarterFeatureKey) {
    if (picked.includes(id)) {
      update({ selectedFeatures: picked.filter((f) => f !== id) });
    } else {
      // First STARTER_FEATURE_LIMIT are included; each extra is billed per feature.
      update({ selectedFeatures: [...picked, id] });
    }
  }

  return (
    <div className="mk-choices">
      <div className="mk-cycle-toggle" role="radiogroup" aria-label="Billing cycle">
        <button
          type="button"
          role="radio"
          aria-checked={!yearly}
          data-selected={!yearly}
          onClick={() => update({ billingCycle: "monthly" })}
        >
          Monthly
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={yearly}
          data-selected={yearly}
          onClick={() => update({ billingCycle: "yearly" })}
        >
          Yearly
          {bestSavingPercent > 0 && <em>save up to {bestSavingPercent}%</em>}
        </button>
      </div>
      <p className="mk-hint" style={{ gridColumn: "1 / -1", marginTop: -4 }}>
        {yearly
          ? "Pay for a full year up front and keep the same one-time setup fee."
          : "Billed every month. Switch to yearly to pay less overall."}
      </p>

      {packages.map((p) => {
        const selected = draft.packageKey === p.key;
        return (
          <button key={p.key} type="button" className="mk-choice" data-selected={selected}
            style={{ alignItems: "flex-start" }} onClick={() => update({ packageKey: p.key })}>
            <span style={{ flex: 1 }}>
              <b style={{ fontSize: 16 }}>
                {p.name} {p.tag && <span className="mk-chip" style={{ marginLeft: 8, padding: "3px 10px", fontSize: 11 }}>{p.tag}</span>}
              </b>
              <small style={{ display: "block", margin: "4px 0 8px" }}>{p.blurb}</small>
              <span style={{ fontFamily: "var(--font-head)", fontSize: 22, color: "var(--green)" }}>
                {yearly ? p.yearlyPriceLabel : (p.discountLabel ?? p.priceLabel)}
                {!yearly && p.discountLabel && (
                  <s style={{ marginLeft: 8, fontSize: 16, opacity: 0.5, fontWeight: 400, color: "inherit" }}>
                    {p.priceLabel}
                  </s>
                )}
                <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)" }}>
                  {yearly ? "/year" : "/month"}
                </span>
              </span>
              {yearly && p.yearlySavingsCents > 0 && (
                <small style={{ display: "block", marginTop: 2, color: "var(--green)", fontWeight: 600 }}>
                  Save {peso(p.yearlySavingsCents)} vs {p.priceLabel}/month
                </small>
              )}
              {p.setupFeeCents > 0 && (
                <small
                  style={{
                    display: "block",
                    marginTop: 2,
                    color: p.setupFeeWaived ? "var(--green)" : "var(--muted)",
                    fontWeight: p.setupFeeWaived ? 600 : 400,
                  }}
                >
                  {p.setupFeeWaived
                    ? `FREE setup (${peso(p.setupFeeCents)} waived)`
                    : `+ ${peso(p.setupFeeCents)} one-time setup`}
                </small>
              )}
            </span>
            {selected && <Check className="mk-choice-check" size={22} />}
          </button>
        );
      })}

      {isStarter && (
        <div className="mk-card" style={{ marginTop: 8, gridColumn: "1 / -1" }}>
          <h3 className="mk-h3" style={{ fontSize: "1.05rem", marginBottom: 4 }}>
            Pick your features
          </h3>
          <p className="mk-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Your Starter store always includes the ordering website, product catalog, and full
            store admin. The first {STARTER_FEATURE_LIMIT} add-on pages are included — each extra
            is {peso(STARTER_EXTRA_FEATURE_PRICE_CENTS)}. ({picked.length} selected)
          </p>
          <div className="mk-choices">
            {STARTER_FEATURE_OPTIONS.map((f) => {
              const on = picked.includes(f.id);
              // A pick is billed once the included allotment is used up: selected
              // features beyond the limit, or the next pick when already at/over it.
              const billed = on
                ? picked.indexOf(f.id) >= STARTER_FEATURE_LIMIT
                : picked.length >= STARTER_FEATURE_LIMIT;
              const Icon = ICONS[f.icon];
              return (
                <button
                  key={f.id}
                  type="button"
                  className="mk-choice"
                  data-selected={on}
                  style={{ alignItems: "flex-start" }}
                  onClick={() => toggleFeature(f.id)}
                >
                  {Icon && <Icon size={20} style={{ flexShrink: 0, marginTop: 2 }} />}
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 15 }}>
                      {f.label}{" "}
                      {billed && (
                        <span className="mk-chip" style={{ marginLeft: 4, padding: "2px 8px", fontSize: 11 }}>
                          +{peso(STARTER_EXTRA_FEATURE_PRICE_CENTS)}
                        </span>
                      )}
                    </b>
                    <small style={{ display: "block", marginTop: 2 }}>{f.desc}</small>
                  </span>
                  {on && <Check className="mk-choice-check" size={20} />}
                </button>
              );
            })}
          </div>
          {extras > 0 && (
            <>
              <p className="mk-hint" style={{ marginTop: 12, fontWeight: 600, color: "var(--ink)" }}>
                {extras} extra feature{extras > 1 ? "s" : ""} × {peso(STARTER_EXTRA_FEATURE_PRICE_CENTS)} ={" "}
                <span style={{ color: "var(--green)" }}>{peso(addonCents)}</span> added to your one-time setup.
              </p>
              {business && (
                // Past the included allotment, Business is the better buy: every
                // add-on page is bundled, plus the full storefront + cart.
                <div className="mk-upsell">
                  <b>Business already includes all of these — and more.</b>
                  <p>
                    You&apos;re paying {peso(addonCents)} extra on Starter. Business bundles every
                    add-on page, the full online storefront + cart, and sales analytics for{" "}
                    {yearly ? `${business.yearlyPriceLabel}/year` : `${business.priceLabel}/month`} —
                    with FREE setup.
                  </p>
                  <button
                    type="button"
                    className="mk-btn mk-btn-primary"
                    onClick={() => update({ packageKey: "pro" })}
                  >
                    Switch to Business
                  </button>
                </div>
              )}
            </>
          )}
          {errors.selectedFeatures && <p className="mk-error">{errors.selectedFeatures}</p>}
        </div>
      )}
    </div>
  );
}

/* ============================================================ Checkout */
export function CheckoutStep({ draft, update, errors, packagePayment, packages }: StepProps) {
  const payMethods = visiblePackagePaymentMethods(packagePayment);
  const chosen = payMethods.find((m) => m.id === draft.paidWithMethodId) ?? null;
  const pkg = packages.find((p) => p.key === draft.packageKey);
  const extraFeatureCount =
    draft.packageKey === "starter"
      ? Math.max(0, draft.selectedFeatures.length - STARTER_FEATURE_LIMIT)
      : 0;
  const quote = checkoutQuote(
    pkg ?? { priceCents: 0, yearlyPriceCents: 0, setupFeeCents: 0, setupFeeWaived: false },
    { trial: false, extraFeatureCount, billingCycle: draft.billingCycle, qrphFee: chosen?.qrph === true },
  );
  const yearly = quote.billingCycle === "yearly";
  const root = storeRootDomain();
  return (
    <div>
      <div className="mk-paybox">
        <h4>Pay for your {packageLabel(draft.packageKey)} package</h4>
        <p className="mk-hint" style={{ marginTop: 2 }}>{packagePayment.instructions}</p>
        <div style={{ marginTop: 10 }}>
          <div className="mk-payrow">
            <span>
              {packageLabel(draft.packageKey)} — {yearly ? "1 year (prepaid)" : "first month"}
            </span>
            <span style={{ textAlign: "right" }}>{peso(quote.baseCents)}</span>
          </div>
          {quote.addonCents > 0 && (
            <div className="mk-payrow">
              <span>
                Extra features ({extraFeatureCount} × {peso(STARTER_EXTRA_FEATURE_PRICE_CENTS)})
              </span>
              <span style={{ textAlign: "right" }}>{peso(quote.addonCents)}</span>
            </div>
          )}
          {quote.setupFeeCents > 0 && (
            <div className="mk-payrow">
              <span>One-time setup fee</span>
              <span style={{ textAlign: "right" }}>{peso(quote.setupFeeCents)}</span>
            </div>
          )}
          {quote.setupFeeWaived && (
            <div className="mk-payrow">
              <span>One-time setup fee</span>
              <span style={{ textAlign: "right", color: "var(--green)", fontWeight: 600 }}>
                FREE{" "}
                <s style={{ color: "var(--muted)", fontWeight: 400 }}>
                  {peso(pkg?.setupFeeCents ?? 0)}
                </s>
              </span>
            </div>
          )}
          {quote.paymentFeeCents > 0 && (
            <div className="mk-payrow">
              <span>{QRPH_FEE_LABEL}</span>
              <span style={{ textAlign: "right" }}>{peso(quote.paymentFeeCents)}</span>
            </div>
          )}
        </div>
        <div className="mk-payrow" style={{ marginTop: 4 }}>
          <span>
            <b>Amount to pay</b>
          </span>
          <span style={{ textAlign: "right" }}>
            <b style={{ fontFamily: "var(--font-head)", fontSize: 22 }}>{peso(quote.totalCents)}</b>
          </span>
        </div>
      </div>

      <Field label="How are you paying?" required error={errors.paidWithMethodId}>
        <div className="mk-choices" role="radiogroup" aria-label="Payment method">
          {payMethods.map((m) => {
            const selected = chosen?.id === m.id;
            return (
              <div key={m.id} className="mk-choice" data-selected={selected}
                style={{ display: "block", padding: 0 }}>
                <button type="button" role="radio" aria-checked={selected}
                  onClick={() => update({ paidWithMethodId: m.id })}
                  style={{
                    all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                  }}>
                  <span style={{ flex: 1 }}>
                    <b>{m.method}</b>
                    {m.qrph && (
                      <small style={{ display: "block", color: "var(--muted)" }}>+2% processing fee</small>
                    )}
                  </span>
                  {selected && <Check className="mk-choice-check" size={20} />}
                </button>
                {selected && (
                  <div style={{ padding: "0 16px 16px" }}>
                    {m.note && <p className="mk-hint" style={{ marginTop: 0 }}>{m.note}</p>}
                    {(m.account || m.number) && (
                      <p style={{ margin: "6px 0 0" }}>
                        {m.account}
                        {m.number && <><br /><b>{m.number}</b></>}
                      </p>
                    )}
                    {m.qrUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.qrUrl} alt={`${m.method} payment QR code`} width={220} height={220}
                        style={{ display: "block", width: 220, height: 220, objectFit: "contain", marginTop: 10, borderRadius: 8, background: "#fff" }} />
                    )}
                    <p className="mk-hint" style={{ marginBottom: 0 }}>
                      Send exactly <b>{peso(quote.totalCents)}</b>, then upload your receipt below.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Field>

      <Field label="Proof of payment" required error={errors.paymentProofUrl}
        hint="Upload a screenshot of your payment receipt.">
        <SingleUpload value={draft.paymentProofUrl} kind="proof" label="Upload proof of payment"
          aspect="3 / 4" onChange={(url) => update({ paymentProofUrl: url })} />
      </Field>

      <div className="mk-card" style={{ background: "var(--paper-deep)", marginBottom: 18 }}>
        <h3 className="mk-h3" style={{ fontSize: "1.1rem", marginBottom: 12 }}>Your order</h3>
        <div className="mk-review-grid">
          <div className="mk-review-item"><span>Business</span><b>{draft.businessName || "—"}</b></div>
          <div className="mk-review-item">
            <span>Store address</span>
            <b>
              {draft.businessName.trim().length >= 2
                ? `${draft.storeSlug || baseStoreSlug(draft.businessName)}.${root}`
                : "—"}
            </b>
          </div>
          <div className="mk-review-item"><span>Package</span><b>{packageLabel(draft.packageKey)}</b></div>
          <div className="mk-review-item">
            <span>Billing</span>
            <b>{yearly ? "Yearly (prepaid)" : "Monthly"}</b>
          </div>
          {draft.packageKey === "starter" && (
            <div className="mk-review-item">
              <span>Features</span>
              <b>
                {draft.selectedFeatures.length
                  ? draft.selectedFeatures.map((f) => STARTER_FEATURE_LABELS[f]).join(", ")
                  : "—"}
              </b>
            </div>
          )}
          <div className="mk-review-item"><span>Paid with</span><b>{chosen?.method ?? "—"}</b></div>
        </div>
        <p className="mk-hint" style={{ marginBottom: 0 }}>
          After payment you can share your logo, products and preferences — or skip and we&apos;ll
          ask you on WhatsApp.
        </p>
      </div>

      <label className="mk-check" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={draft.termsAccepted}
          onChange={(e) => update({ termsAccepted: e.target.checked })} />
        <span>
          I understand the timeline, revisions, and onboarding process, and I agree to the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="mk-link">
            terms and conditions
          </a>
          .
        </span>
      </label>
      {errors.termsAccepted && <p className="mk-error">{errors.termsAccepted}</p>}

      {/* Honeypot — hidden from real users; bots fill it and get rejected. */}
      <input type="text" tabIndex={-1} autoComplete="off" className="mk-sr" aria-hidden="true"
        value={draft.website} onChange={(e) => update({ website: e.target.value })} />
    </div>
  );
}
