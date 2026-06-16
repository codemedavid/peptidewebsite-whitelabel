"use client";

import type { ReactNode } from "react";
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
} from "../useOnboardingForm";
import { STARTER_FEATURE_LABELS, type StarterFeatureKey } from "@/lib/onboarding/schema";
import { SingleUpload, MultiUpload } from "../uploads";
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
export function BusinessStep({ draft, update, errors }: StepProps) {
  return (
    <div>
      <Field label="Business name" htmlFor="biz-name" required error={errors.businessName}>
        <Text id="biz-name" value={draft.businessName} error={!!errors.businessName}
          placeholder="e.g. Glow Manila" onChange={(v) => update({ businessName: v })} />
      </Field>
      <div className="mk-field-row">
        <Field label="Business type" htmlFor="biz-type" hint="e.g. Skincare, Peptides, Reseller">
          <Text id="biz-type" value={draft.businessType} placeholder="Skincare & beauty"
            onChange={(v) => update({ businessType: v })} />
        </Field>
        <Field label="Contact person" htmlFor="biz-contact">
          <Text id="biz-contact" value={draft.contactPerson} placeholder="Your name"
            onChange={(v) => update({ contactPerson: v })} />
        </Field>
      </div>
      <Field label="Business description" htmlFor="biz-desc" hint="One or two lines we can use on your homepage.">
        <textarea id="biz-desc" className="mk-textarea" value={draft.description}
          placeholder="What you sell and what makes you special."
          onChange={(e) => update({ description: e.target.value })} />
      </Field>
      <div className="mk-field-row">
        <Field label="Email address" htmlFor="biz-email" required error={errors.email}>
          <Text id="biz-email" type="email" value={draft.email} error={!!errors.email}
            placeholder="you@business.com" onChange={(v) => update({ email: v })} />
        </Field>
        <Field label="WhatsApp number" htmlFor="biz-wa" hint="International format, digits only.">
          <Text id="biz-wa" value={draft.whatsapp} placeholder="639171234567"
            onChange={(v) => update({ whatsapp: v })} />
        </Field>
      </div>
      <Field label="Facebook / Messenger link" htmlFor="biz-fb">
        <Text id="biz-fb" value={draft.facebook} placeholder="https://facebook.com/yourpage"
          onChange={(v) => update({ facebook: v })} />
      </Field>
    </div>
  );
}

/* ============================================================ Step 2 */
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

/* ============================================================ Step 3 */
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

/* ============================================================ Step 4 */
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

/* ============================================================ Step 5 */
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
                <b style={{ color: "var(--ink-900)" }}>{name}</b>
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

/* ============================================================ Step 6 */
export function PackageStep({ draft, update, errors, packages }: StepProps) {
  const isStarter = draft.packageKey === "starter";
  const picked = draft.selectedFeatures;

  function toggleFeature(id: StarterFeatureKey) {
    if (picked.includes(id)) {
      update({ selectedFeatures: picked.filter((f) => f !== id) });
    } else if (picked.length < STARTER_FEATURE_LIMIT) {
      update({ selectedFeatures: [...picked, id] });
    }
    // At the limit, ignore further additions — the client must deselect first.
  }

  return (
    <div className="mk-choices">
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
              <span style={{ fontFamily: "var(--font-head)", fontSize: 22, color: "var(--rose-700)", fontWeight: 700 }}>
                {p.discountLabel ?? p.priceLabel}
                {p.discountLabel && (
                  <s style={{ marginLeft: 8, fontSize: 16, opacity: 0.5, fontWeight: 400, color: "inherit" }}>
                    {p.priceLabel}
                  </s>
                )}
              </span>
            </span>
            {selected && <Check className="mk-choice-check" size={22} />}
          </button>
        );
      })}

      {isStarter && (
        <div className="mk-card" style={{ marginTop: 8, gridColumn: "1 / -1" }}>
          <h3 className="mk-h3" style={{ fontSize: "1.05rem", marginBottom: 4 }}>
            Pick {STARTER_FEATURE_LIMIT} features
          </h3>
          <p className="mk-hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Your Starter store always includes the ordering website, product catalog, and full
            store admin. Choose {STARTER_FEATURE_LIMIT} add-on pages to go live with
            ({picked.length}/{STARTER_FEATURE_LIMIT} selected).
          </p>
          <div className="mk-choices">
            {STARTER_FEATURE_OPTIONS.map((f) => {
              const on = picked.includes(f.id);
              const atLimit = !on && picked.length >= STARTER_FEATURE_LIMIT;
              const Icon = ICONS[f.icon];
              return (
                <button
                  key={f.id}
                  type="button"
                  className="mk-choice"
                  data-selected={on}
                  disabled={atLimit}
                  style={{ alignItems: "flex-start", opacity: atLimit ? 0.5 : 1 }}
                  onClick={() => toggleFeature(f.id)}
                >
                  {Icon && <Icon size={20} style={{ flexShrink: 0, marginTop: 2 }} />}
                  <span style={{ flex: 1 }}>
                    <b style={{ fontSize: 15 }}>{f.label}</b>
                    <small style={{ display: "block", marginTop: 2 }}>{f.desc}</small>
                  </span>
                  {on && <Check className="mk-choice-check" size={20} />}
                </button>
              );
            })}
          </div>
          {errors.selectedFeatures && <p className="mk-error">{errors.selectedFeatures}</p>}
        </div>
      )}
    </div>
  );
}

/* ============================================================ Step 7 */
export function CheckoutStep({ draft, update, errors, packagePayment }: StepProps) {
  const namedProducts = draft.products.filter((p) => p.name.trim()).length;
  const payMethods = visiblePackagePaymentMethods(packagePayment);
  return (
    <div>
      <div className="mk-paybox">
        <h4>Pay for your {packageLabel(draft.packageKey)} package</h4>
        <p className="mk-hint" style={{ marginTop: 2 }}>{packagePayment.instructions}</p>
        <div style={{ marginTop: 12 }}>
          {payMethods.map((m) => (
            <div className="mk-payrow" key={m.id}>
              <span>
                <b>{m.method}</b>
                {m.note && <small style={{ display: "block", color: "var(--ink-500)" }}>{m.note}</small>}
                {m.qrUrl && (
                  <img
                    src={m.qrUrl}
                    alt={`${m.method} payment QR code`}
                    style={{ display: "block", width: 160, height: 160, objectFit: "contain", marginTop: 10, borderRadius: 8, background: "#fff" }}
                  />
                )}
              </span>
              <span style={{ textAlign: "right" }}>
                {m.account}
                <br />
                <b>{m.number}</b>
              </span>
            </div>
          ))}
        </div>
      </div>

      <Field label="Proof of payment" required error={errors.paymentProofUrl}
        hint="Upload a screenshot of your payment receipt.">
        <SingleUpload value={draft.paymentProofUrl} kind="proof" label="Upload proof of payment"
          aspect="3 / 4" onChange={(url) => update({ paymentProofUrl: url })} />
      </Field>

      <div className="mk-card" style={{ background: "var(--rose-50)", marginBottom: 18 }}>
        <h3 className="mk-h3" style={{ fontSize: "1.1rem", marginBottom: 12 }}>Your store at a glance</h3>
        <div className="mk-review-grid">
          <div className="mk-review-item"><span>Business</span><b>{draft.businessName || "—"}</b></div>
          <div className="mk-review-item"><span>Package</span><b>{packageLabel(draft.packageKey)}</b></div>
          <div className="mk-review-item"><span>Products added</span><b>{namedProducts}</b></div>
          <div className="mk-review-item"><span>Orders go to</span><b style={{ textTransform: "capitalize" }}>{draft.orderDestination}</b></div>
          <div className="mk-review-item"><span>Payment methods</span><b>{draft.paymentMethods.length || "—"}</b></div>
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
        </div>
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
