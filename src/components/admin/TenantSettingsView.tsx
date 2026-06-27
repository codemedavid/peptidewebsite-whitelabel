"use client";

// Tenant settings, reorganized per the "Tenant Settings" Claude Design prototype:
// a sticky table-of-contents with scroll-spy down the left, card-based sections
// with eyebrow/title/description headers and a footer save action, split rows
// (label + help on the left, control on the right), a live order-number preview
// chip, brand-iconed channel cards, and a sticky "unsaved changes" bar that can
// save or discard every dirty section at once. Wired to the existing server
// actions — saveOrderFormatAction and saveContactChannelsAction.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ic } from "@/components/admin/shell/primitives";
import { saveOrderFormatAction, setTenantFeatureAction } from "@/actions/onboarding";
import { FEATURES } from "@/lib/features/catalog";
import {
  saveContactChannelsAction,
  saveAdminFeeAction,
  saveAdminPasswordAction,
  saveRequirePaymentProofAction,
} from "@/actions/branding";
import { CONTACT_CHANNEL_META, META_DESCRIPTION_MAX } from "@/lib/storefront/contact-channels";
import {
  ADMIN_FEE_AMOUNT_MAX,
  ADMIN_FEE_LABEL_DEFAULT,
  ADMIN_FEE_LABEL_MAX,
  type AdminFeeConfig,
} from "@/lib/storefront/admin-fee";
import {
  formatOrderNumber,
  normalizeOrderNumberFormat,
  PREFIX_RE,
  MIN_DIGITS,
  MAX_DIGITS,
  type OrderNumberFormat,
  type OrderNumberScheme,
} from "@/lib/orders/order-number-format";
import type { ContactChannel, ContactChannelType } from "@/storefront/types";

const CHECKOUT_TITLE_MAX = 60;
const CHECKOUT_NOTE_MAX = 200;

/* Brand glyphs for the channel cards — lucide has no brand icons, so these match
   the prototype's inline SVGs. Keyed by the canonical channel type. */
const CHANNEL_GLYPH: Record<ContactChannelType, React.ReactNode> = {
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M.057 24l1.687-6.163A11.867 11.867 0 0 1 .075 11.85C.075 5.305 5.403 0 11.95 0a11.83 11.83 0 0 1 8.413 3.488 11.87 11.87 0 0 1 3.476 8.4c-.003 6.545-5.33 11.85-11.876 11.85a11.9 11.9 0 0 1-5.687-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.881.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.881-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.982zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.149-.173.198-.297.297-.495.099-.198.05-.372-.025-.521-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.464.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  ),
  messenger: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.471 8.652V24l4.086-2.242c1.09.301 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.193 14.963l-3.056-3.259-5.963 3.259L10.733 8l3.13 3.259L19.752 8l-6.559 6.963z" />
    </svg>
  ),
  viber: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.398.002C9.473.028 5.331.344 3.014 2.467 1.294 4.177.693 6.698.623 9.82c-.06 3.11-.135 8.949 5.487 10.535v2.42s-.038.97.602 1.17c.79.248 1.251-.51 2.004-1.32l1.406-1.588c3.847.318 6.8-.42 7.139-.53.776-.252 5.171-.816 5.886-6.652.74-6.017-.36-9.82-2.34-11.534-.595-.55-2.99-2.295-8.336-2.319 0 0-.393-.025-1.06-.001zm.067 1.697c.564-.004.902.017.902.017 4.523.02 6.69 1.398 7.194 1.858 1.675 1.43 2.534 4.857 1.908 9.885-.595 4.88-4.16 5.19-4.817 5.4-.281.09-2.874.735-6.135.523 0 0-2.43 2.93-3.188 3.69-.118.119-.258.155-.35.132-.13-.033-.166-.188-.165-.414l.02-4.025c-4.762-1.323-4.485-6.292-4.434-8.89.05-2.598.535-4.722 1.99-6.16 1.96-1.772 5.477-2.04 7.077-2.045zm.5 2.495a.241.241 0 0 0-.241.241.241.241 0 0 0 .240.243c1.521.012 2.738.518 3.659 1.467.92.948 1.388 2.225 1.398 3.844a.243.243 0 0 0 .243.24h.001a.244.244 0 0 0 .240-.243c-.011-1.715-.516-3.122-1.532-4.17-1.014-1.046-2.404-1.607-4.005-1.622zm-3.235.955a.749.749 0 0 0-.564.169l-.005.004c-.39.305-.762.66-1.044 1.057-.255.366-.394.726-.428 1.078-.02.21.013.42.13.685l.01.005c.343.793.79 1.53 1.34 2.236.71.91 1.564 1.728 2.547 2.43l.009.006.553.471.006.005c.706.55 1.443.996 2.235 1.34l.005.009c.265.117.475.15.686.13.351-.034.711-.173 1.078-.428.396-.282.751-.654 1.057-1.044l.004-.005a.749.749 0 0 0 .168-.564.732.732 0 0 0-.314-.49l-.006-.004c-.42-.27-.864-.495-1.314-.736-.286-.151-.582-.123-.838.044l-.014.01-.298.226a.24.24 0 0 1-.166.05c-.16-.024-.501-.196-.984-.677-.482-.482-.654-.823-.677-.984a.24.24 0 0 1 .05-.166l.226-.298.01-.014c.167-.256.195-.552.044-.838-.241-.45-.466-.894-.736-1.314l-.004-.006a.732.732 0 0 0-.49-.314.736.736 0 0 0-.082-.005zm3.464.504a.241.241 0 0 0-.224.258.241.241 0 0 0 .258.224c.964.064 1.65.375 2.124.892.475.518.722 1.166.71 1.985a.242.242 0 0 0 .238.245.243.243 0 0 0 .245-.238c.014-.93-.275-1.715-.836-2.327-.562-.612-1.382-.967-2.451-1.038a.246.246 0 0 0-.034-.001zm.336 1.46a.241.241 0 0 0-.052.479c.667.13.984.46 1.078 1.165a.241.241 0 0 0 .27.207.241.241 0 0 0 .208-.27c-.117-.876-.602-1.42-1.463-1.587a.243.243 0 0 0-.04-.004z" />
    </svg>
  ),
  gmail: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M1.5 20.25h3v-9.273L0 7.477v11.25c0 .842.683 1.523 1.5 1.523zm18 0h3c.84 0 1.5-.681 1.5-1.523V7.477l-4.5 3.5v9.273zM19.5 4.5v6.477L24 7.477V5.25c0-2.063-2.355-3.24-4.005-2.004L19.5 4.5zM12 13.5L4.5 7.875v-3.375L12 10.125l7.5-5.625v3.375L12 13.5zM0 5.25v2.227l4.5 3.5V4.5l-.495-1.254C2.355 2.01 0 3.187 0 5.25z" />
    </svg>
  ),
};

type Props = {
  slug: string;
  name: string;
  domain: string;
  format: OrderNumberFormat;
  initialChannels: ContactChannel[];
  initialCheckoutTitle: string;
  initialCheckoutNote: string;
  /** Link-preview / SEO description; blank falls back to a generic vertical line. */
  initialMetaDescription: string;
  /** Whether checkout requires a proof-of-payment upload. */
  initialRequireProofOfPayment: boolean;
  /** Checkout admin-fee config + the store's currency symbol for display. */
  initialAdminFee: AdminFeeConfig & { currency: string };
  /** Whether the tenant is entitled to the admin-fee feature (admin → Features).
   *  When false the fee section is shown locked — no fee is charged at checkout. */
  adminFeeEntitled: boolean;
  /** Storefront-admin password override; blank means the default ("admin"). */
  initialAdminPassword: string;
  lastSaved?: string;
  /** Plan & status card, rendered first in the sections column (its own save flow). */
  planStatus?: React.ReactNode;
  /** Custom-domain card, rendered in the sections column (its own save flow). */
  domains?: React.ReactNode;
};

const SECTIONS = [
  { id: "orders", label: "Order numbers" },
  { id: "channels", label: "Checkout channels" },
  { id: "proof", label: "Payment proof" },
  { id: "fee", label: "Admin fee" },
  { id: "copy", label: "Checkout copy" },
  { id: "admin", label: "Admin access" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function TenantSettingsView({
  slug,
  name,
  domain,
  format,
  initialChannels,
  initialCheckoutTitle,
  initialCheckoutNote,
  initialMetaDescription,
  initialRequireProofOfPayment,
  initialAdminFee,
  adminFeeEntitled,
  initialAdminPassword,
  lastSaved,
  planStatus,
  domains,
}: Props) {
  /* ---------- order-number format ---------- */
  const [prefix, setPrefix] = useState(format.prefix);
  const [separator, setSeparator] = useState(format.separator);
  const [scheme, setScheme] = useState<OrderNumberScheme>(format.scheme);
  const [digits, setDigits] = useState(format.digits);

  /* ---------- channels + checkout copy ---------- */
  const [channels, setChannels] = useState<ContactChannel[]>(initialChannels);
  const [requireProof, setRequireProof] = useState(initialRequireProofOfPayment);
  const [title, setTitle] = useState(initialCheckoutTitle);
  const [note, setNote] = useState(initialCheckoutNote);
  const [metaDescription, setMetaDescription] = useState(initialMetaDescription);

  /* ---------- admin fee ---------- */
  // Master on/off for the whole admin-fee capability (the STORE_ADMIN_FEE
  // entitlement). Off = no fee anywhere + the config fields below are hidden.
  // Saved immediately on toggle via setTenantFeatureAction (its own flow, so it
  // never marks the section dirty), with optimistic state + revert on failure.
  const [featureOn, setFeatureOn] = useState(adminFeeEntitled);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [feeEnabled, setFeeEnabled] = useState(initialAdminFee.enabled);
  const [feeLabel, setFeeLabel] = useState(initialAdminFee.label);
  // Kept as the raw input string so partial entries ("12.") don't fight the
  // field; parsed/validated on save.
  const [feeAmount, setFeeAmount] = useState(
    initialAdminFee.amount > 0 ? String(initialAdminFee.amount) : "",
  );
  const currency = initialAdminFee.currency;

  /* ---------- storefront-admin password ---------- */
  const [adminPassword, setAdminPassword] = useState(initialAdminPassword);
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  /* baseline for dirty tracking; advances on a successful save */
  const baseline = useRef({
    prefix: format.prefix,
    separator: format.separator,
    scheme: format.scheme,
    digits: format.digits,
    channels: JSON.stringify(initialChannels),
    requireProof: initialRequireProofOfPayment,
    title: initialCheckoutTitle,
    note: initialCheckoutNote,
    metaDescription: initialMetaDescription,
    feeEnabled: initialAdminFee.enabled,
    feeLabel: initialAdminFee.label,
    feeAmount: initialAdminFee.amount > 0 ? String(initialAdminFee.amount) : "",
    adminPassword: initialAdminPassword,
  });

  const [saving, setSaving] = useState<SectionId | "all" | null>(null);
  const [saved, setSaved] = useState<Record<SectionId, boolean>>({
    orders: false,
    channels: false,
    proof: false,
    fee: false,
    copy: false,
    admin: false,
  });
  const [errors, setErrors] = useState<Partial<Record<SectionId, string>>>({});

  const ordersDirty =
    prefix !== baseline.current.prefix ||
    separator !== baseline.current.separator ||
    scheme !== baseline.current.scheme ||
    digits !== baseline.current.digits;
  const channelsDirty = JSON.stringify(channels) !== baseline.current.channels;
  const proofDirty = requireProof !== baseline.current.requireProof;
  const copyDirty =
    title !== baseline.current.title ||
    note !== baseline.current.note ||
    metaDescription !== baseline.current.metaDescription;
  const feeDirty =
    feeEnabled !== baseline.current.feeEnabled ||
    feeLabel !== baseline.current.feeLabel ||
    feeAmount !== baseline.current.feeAmount;
  const adminDirty = adminPassword !== baseline.current.adminPassword;
  const anyDirty =
    ordersDirty || channelsDirty || proofDirty || feeDirty || copyDirty || adminDirty;

  /* ---------- admin-fee validation + preview ---------- */
  const feeAmountNum = Number(feeAmount);
  const feeAmountValid =
    Number.isFinite(feeAmountNum) && feeAmountNum > 0 && feeAmountNum <= ADMIN_FEE_AMOUNT_MAX;
  // An off fee needs no amount; an on fee must charge something real.
  const feeValid = !feeEnabled || feeAmountValid;
  const feePreviewLabel = feeLabel.trim() || ADMIN_FEE_LABEL_DEFAULT;

  /* ---------- order-number validation + preview ---------- */
  const prefixValid = PREFIX_RE.test(prefix);
  const normalized = normalizeOrderNumberFormat({ prefix, separator, scheme, digits }, name);
  const preview = prefixValid
    ? formatOrderNumber(normalized, scheme === "sequential" ? 1001 : Number("4".repeat(digits)) % 10 ** digits)
    : "—";

  /* ---------- channel helpers ---------- */
  const get = (type: ContactChannelType) =>
    channels.find((c) => c.type === type) ?? { type, destination: "", enabled: false };
  const patch = (type: ContactChannelType, p: Partial<ContactChannel>) => {
    setChannels((cs) => cs.map((c) => (c.type === type ? { ...c, ...p } : c)));
    setSaved((s) => ({ ...s, channels: false }));
    setErrors((e) => ({ ...e, channels: undefined }));
  };
  const incompleteChannels = useMemo(
    () => channels.filter((c) => c.enabled && !c.destination.trim()).map((c) => c.type),
    [channels],
  );
  const enabledCount = channels.filter((c) => c.enabled).length;

  /* ---------- save actions ---------- */
  async function saveOrders(): Promise<boolean> {
    setSaving("orders");
    setErrors((e) => ({ ...e, orders: undefined }));
    const res = await saveOrderFormatAction(slug, { prefix, separator, scheme, digits });
    setSaving(null);
    if ("ok" in res) {
      baseline.current = { ...baseline.current, prefix, separator, scheme, digits };
      setSaved((s) => ({ ...s, orders: true }));
      return true;
    }
    setErrors((e) => ({ ...e, orders: res.error }));
    return false;
  }

  async function saveChannelsAndCopy(section: "channels" | "copy"): Promise<boolean> {
    setSaving(section);
    setErrors((e) => ({ ...e, [section]: undefined }));
    const res = await saveContactChannelsAction(slug, {
      contactChannels: channels,
      checkoutTitle: title,
      checkoutNote: note,
      metaDescription,
    });
    setSaving(null);
    if ("ok" in res) {
      baseline.current = { ...baseline.current, channels: JSON.stringify(channels), title, note, metaDescription };
      setSaved((s) => ({ ...s, channels: true, copy: true }));
      return true;
    }
    setErrors((e) => ({ ...e, [section]: res.error }));
    return false;
  }

  async function saveProof(): Promise<boolean> {
    setSaving("proof");
    setErrors((e) => ({ ...e, proof: undefined }));
    const res = await saveRequirePaymentProofAction(slug, requireProof);
    setSaving(null);
    if ("ok" in res) {
      baseline.current = { ...baseline.current, requireProof };
      setSaved((s) => ({ ...s, proof: true }));
      return true;
    }
    setErrors((e) => ({ ...e, proof: res.error }));
    return false;
  }

  async function saveFee(): Promise<boolean> {
    setSaving("fee");
    setErrors((e) => ({ ...e, fee: undefined }));
    const res = await saveAdminFeeAction(slug, {
      enabled: feeEnabled,
      label: feeLabel,
      amount: Number(feeAmount) || 0,
      // This view only edits the flat fee; pass the saved mode/percent through
      // so a percentage fee configured elsewhere isn't clobbered to fixed.
      mode: initialAdminFee.mode,
      percent: initialAdminFee.percent,
    });
    setSaving(null);
    if ("ok" in res) {
      baseline.current = { ...baseline.current, feeEnabled, feeLabel, feeAmount };
      setSaved((s) => ({ ...s, fee: true }));
      return true;
    }
    setErrors((e) => ({ ...e, fee: res.error }));
    return false;
  }

  async function toggleAdminFeeFeature() {
    if (featureSaving) return;
    const next = !featureOn;
    setFeatureOn(next); // optimistic
    setFeatureSaving(true);
    setErrors((e) => ({ ...e, fee: undefined }));
    const res = await setTenantFeatureAction(slug, FEATURES.STORE_ADMIN_FEE, next);
    setFeatureSaving(false);
    if (!("ok" in res)) {
      setFeatureOn(!next); // revert
      setErrors((e) => ({
        ...e,
        fee: res.error === "FORBIDDEN" ? "You don't have permission to change this." : res.error,
      }));
    }
  }

  async function saveAdminPassword(): Promise<boolean> {
    setSaving("admin");
    setErrors((e) => ({ ...e, admin: undefined }));
    const res = await saveAdminPasswordAction(slug, adminPassword);
    setSaving(null);
    if ("ok" in res) {
      baseline.current = { ...baseline.current, adminPassword };
      setSaved((s) => ({ ...s, admin: true }));
      return true;
    }
    setErrors((e) => ({ ...e, admin: res.error }));
    return false;
  }

  async function saveAll() {
    setSaving("all");
    if (ordersDirty && prefixValid) await saveOrders();
    // Channels + copy share one action, so a single call flushes both.
    if ((channelsDirty || copyDirty) && incompleteChannels.length === 0) await saveChannelsAndCopy("channels");
    if (proofDirty) await saveProof();
    if (feeDirty && feeValid) await saveFee();
    if (adminDirty) await saveAdminPassword();
    setSaving(null);
  }

  function discardAll() {
    const b = baseline.current;
    setPrefix(b.prefix);
    setSeparator(b.separator);
    setScheme(b.scheme);
    setDigits(b.digits);
    setChannels(JSON.parse(b.channels));
    setRequireProof(b.requireProof);
    setTitle(b.title);
    setNote(b.note);
    setMetaDescription(b.metaDescription);
    setFeeEnabled(b.feeEnabled);
    setFeeLabel(b.feeLabel);
    setFeeAmount(b.feeAmount);
    setAdminPassword(b.adminPassword);
    setErrors({});
  }

  /* ---------- scroll-spy TOC ---------- */
  const refs: Record<SectionId, React.RefObject<HTMLElement | null>> = {
    orders: useRef<HTMLElement>(null),
    channels: useRef<HTMLElement>(null),
    proof: useRef<HTMLElement>(null),
    fee: useRef<HTMLElement>(null),
    copy: useRef<HTMLElement>(null),
    admin: useRef<HTMLElement>(null),
  };
  const [active, setActive] = useState<SectionId>("orders");
  useEffect(() => {
    const scroller = document.querySelector(".sa .page");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.getAttribute("data-section") as SectionId);
      },
      { root: scroller, rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    Object.values(refs).forEach((r) => r.current && observer.observe(r.current));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrollTo = (id: SectionId) => refs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const counts: Record<SectionId, string> = {
    orders: "4",
    channels: `${enabledCount}/${CONTACT_CHANNEL_META.length}`,
    proof: requireProof ? "On" : "Off",
    fee: feeEnabled ? "On" : "Off",
    copy: "3",
    admin: adminPassword.trim() ? "Custom" : "Default",
  };

  const mark = name.slice(0, 2).toUpperCase();

  return (
    <div className="page-inner">
      {/* page head */}
      <div className="set-pagehead">
        <div>
          <span className="set-tenant-badge">
            <span className="mark" style={{ background: "linear-gradient(135deg, #34d399, #10b981)" }}>{mark}</span>
            <span className="mono">{domain}</span>
            <span className="badge badge-success">
              <span className="bdot" />
              Live
            </span>
          </span>
          <Link href={`/tenants/${slug}`} className="set-back">
            <Ic.ChevronLeft /> Back to tenant
          </Link>
          <h1 className="set-title">Settings · {name}</h1>
          <p className="set-subtitle">
            Configure how this tenant&apos;s storefront behaves — order numbering, checkout channels, and the
            copy customers see at the moment of purchase.
          </p>
        </div>
      </div>

      <div className="set-layout">
        {/* TOC */}
        <nav className="set-toc" aria-label="On this page">
          <div className="set-toc-title">On this page</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={"set-toc-item" + (active === s.id ? " active" : "")}
              onClick={() => scrollTo(s.id)}
            >
              <span>{s.label}</span>
              <span className="set-toc-count tnum">{counts[s.id]}</span>
            </button>
          ))}
          {lastSaved && (
            <div className="set-toc-meta">
              <div className="k">Last saved</div>
              <div className="v">{lastSaved}</div>
            </div>
          )}
        </nav>

        {/* sections */}
        <div className="set-sections">
          {/* ---------- plan & status (self-contained card) ---------- */}
          {planStatus}

          {/* ---------- order numbers ---------- */}
          <section className="set-card" ref={refs.orders} data-section="orders">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Orders</span>
                <h2>Order numbers</h2>
                <p className="set-desc">
                  The tenant-facing code on every order, e.g. <code>{preview}</code>. Used in receipts, support
                  tickets, and the storefront.
                </p>
              </div>
              <div className="set-preview">
                <span className="lbl">Preview</span>
                <span>{preview}</span>
              </div>
            </div>
            <div className="set-card-body">
              <div className="set-row">
                <div>
                  <div className="set-row-label">Format</div>
                  <div className="set-row-help">Prefix and separator wrap every order number.</div>
                </div>
                <div className="set-row-control">
                  <div className="set-field-row">
                    <label className="set-field">
                      <span className="set-sublabel">Prefix</span>
                      <input
                        className="input mono"
                        style={{ textTransform: "uppercase" }}
                        value={prefix}
                        maxLength={6}
                        aria-invalid={!prefixValid}
                        onChange={(e) => {
                          setPrefix(e.target.value.toUpperCase());
                          setSaved((s) => ({ ...s, orders: false }));
                          setErrors((er) => ({ ...er, orders: undefined }));
                        }}
                      />
                      <span className="set-help">Up to 6 characters. Letters and digits only.</span>
                    </label>
                    <label className="set-field">
                      <span className="set-sublabel">Separator</span>
                      <input
                        className="input mono"
                        value={separator}
                        maxLength={3}
                        onChange={(e) => {
                          setSeparator(e.target.value);
                          setSaved((s) => ({ ...s, orders: false }));
                        }}
                      />
                      <span className="set-help">
                        Common: <code>-</code> <code>·</code> <code>/</code>
                      </span>
                    </label>
                  </div>
                  {!prefixValid && (
                    <div className="set-err">Prefix must be 2–6 upper-case letters or digits (A–Z, 0–9).</div>
                  )}
                </div>
              </div>

              <div className="set-row">
                <div>
                  <div className="set-row-label">Numbering</div>
                  <div className="set-row-help">Sequential is predictable. Random hides volume.</div>
                </div>
                <div className="set-row-control">
                  <div className="set-field-row">
                    <label className="set-field">
                      <span className="set-sublabel">Strategy</span>
                      <div className="set-select-wrap">
                        <select
                          className="set-select"
                          value={scheme}
                          onChange={(e) => {
                            setScheme(e.target.value as OrderNumberScheme);
                            setSaved((s) => ({ ...s, orders: false }));
                          }}
                        >
                          <option value="sequential">Sequential (1001, 1002, …)</option>
                          <option value="random">Random alphanumeric</option>
                        </select>
                      </div>
                    </label>
                    <label className="set-field">
                      <span className="set-sublabel">{scheme === "sequential" ? "Digits" : "Length"}</span>
                      <input
                        className="input mono"
                        type="number"
                        min={MIN_DIGITS}
                        max={MAX_DIGITS}
                        value={digits}
                        onChange={(e) => {
                          setDigits(Number(e.target.value));
                          setSaved((s) => ({ ...s, orders: false }));
                        }}
                      />
                      <span className="set-help">Pads with leading zeros.</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="set-row">
                <div />
                <div className="set-row-control">
                  <div className="set-notice">
                    <Ic.AlertCircle />
                    <div>
                      Changes apply to <b>new orders only</b>. Existing order numbers are never rewritten.
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                Next order will be <code className="mono">{preview}</code>
              </span>
              <div className="set-foot-actions">
                {errors.orders && (
                  <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
                    {errors.orders}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!ordersDirty || saving !== null}
                  onClick={() => {
                    setPrefix(baseline.current.prefix);
                    setSeparator(baseline.current.separator);
                    setScheme(baseline.current.scheme);
                    setDigits(baseline.current.digits);
                    setErrors((e) => ({ ...e, orders: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={saveOrders}
                  disabled={!prefixValid || !ordersDirty || saving !== null}
                >
                  {saving === "orders" ? "Saving…" : saved.orders && !ordersDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save format"
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ---------- checkout channels ---------- */}
          <section className="set-card" ref={refs.channels} data-section="channels">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Checkout</span>
                <h2>Contact channels</h2>
                <p className="set-desc">
                  Customers place orders by messaging the store. Turn on the channels you use and set each
                  destination — they appear as buttons at checkout.
                </p>
              </div>
              <span className={"badge " + (enabledCount > 0 ? "badge-success" : "badge-neutral")}>
                {enabledCount > 0 ? `${enabledCount} enabled` : "None enabled"}
              </span>
            </div>
            <div className="set-card-body">
              {enabledCount === 0 && (
                <div className="set-notice" style={{ marginBottom: 14 }}>
                  <Ic.AlertCircle />
                  <div>
                    No channels enabled — storefront checkout is currently <b>disabled</b>. Enable at least one
                    channel to accept orders.
                  </div>
                </div>
              )}
              <div className="set-channels">
                {CONTACT_CHANNEL_META.map((meta) => {
                  const ch = get(meta.type);
                  const missing = ch.enabled && !ch.destination.trim();
                  return (
                    <div key={meta.type} className={"set-channel" + (ch.enabled ? " enabled" : "")}>
                      <div
                        className="set-channel-head"
                        role="button"
                        tabIndex={0}
                        onClick={() => patch(meta.type, { enabled: !ch.enabled })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            patch(meta.type, { enabled: !ch.enabled });
                          }
                        }}
                      >
                        <div className={"set-channel-icon " + meta.type}>{CHANNEL_GLYPH[meta.type]}</div>
                        <div className="set-channel-meta">
                          <div className="name">{meta.label}</div>
                          <div className="sub">{meta.hint}</div>
                        </div>
                        <span
                          className={"switch" + (ch.enabled ? " on" : "")}
                          role="switch"
                          aria-checked={ch.enabled}
                          aria-label={`Enable ${meta.label}`}
                        />
                      </div>
                      {ch.enabled && (
                        <div className="set-channel-body">
                          <input
                            className="input"
                            value={ch.destination}
                            placeholder={meta.placeholder}
                            aria-invalid={missing}
                            aria-label={`${meta.label} destination`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => patch(meta.type, { destination: e.target.value })}
                          />
                          {missing && <div className="set-err">Enter a destination or turn this off.</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                Buttons appear in checkout in the order shown above.
              </span>
              <div className="set-foot-actions">
                {errors.channels && (
                  <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
                    {errors.channels}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!channelsDirty || saving !== null}
                  onClick={() => {
                    setChannels(JSON.parse(baseline.current.channels));
                    setErrors((e) => ({ ...e, channels: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={() => saveChannelsAndCopy("channels")}
                  disabled={incompleteChannels.length > 0 || !channelsDirty || saving !== null}
                >
                  {saving === "channels" ? "Saving…" : saved.channels && !channelsDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save channels"
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ---------- payment proof ---------- */}
          <section className="set-card" ref={refs.proof} data-section="proof">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Checkout</span>
                <h2>Payment proof</h2>
                <p className="set-desc">
                  Whether customers must upload a proof-of-payment screenshot to complete checkout
                  when payment methods are configured.
                </p>
              </div>
              <span className={"badge " + (requireProof ? "badge-success" : "badge-neutral")}>
                {requireProof ? "Required" : "Optional"}
              </span>
            </div>
            <div className="set-card-body">
              <div className="set-row">
                <div>
                  <div className="set-row-label">Require proof of payment</div>
                  <div className="set-row-help">
                    When on, the proof upload is mandatory at checkout. Turn off to make it optional —
                    customers can place an order without attaching a screenshot.
                  </div>
                </div>
                <div className="set-row-control">
                  <span
                    className={"switch" + (requireProof ? " on" : "")}
                    role="switch"
                    aria-checked={requireProof}
                    aria-label="Require proof of payment at checkout"
                    tabIndex={0}
                    onClick={() => {
                      setRequireProof((v) => !v);
                      setSaved((s) => ({ ...s, proof: false }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setRequireProof((v) => !v);
                        setSaved((s) => ({ ...s, proof: false }));
                      }
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                Takes effect immediately on the storefront checkout.
              </span>
              <div className="set-foot-actions">
                {errors.proof && (
                  <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
                    {errors.proof}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!proofDirty || saving !== null}
                  onClick={() => {
                    setRequireProof(baseline.current.requireProof);
                    setErrors((e) => ({ ...e, proof: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={saveProof}
                  disabled={!proofDirty || saving !== null}
                >
                  {saving === "proof" ? "Saving…" : saved.proof && !proofDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ---------- admin fee ---------- */}
          <section className="set-card" ref={refs.fee} data-section="fee">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Checkout</span>
                <h2>Admin fee</h2>
                <p className="set-desc">
                  A flat charge added on top of the order total at checkout — e.g. a processing or
                  service fee. Customers see it as its own line in the totals; it&apos;s included in
                  the order&apos;s total everywhere (checkout, tracking, store admin, analytics).
                </p>
              </div>
              <span
                className={
                  "badge " +
                  (featureOn ? (feeEnabled ? "badge-success" : "badge-neutral") : "badge-neutral")
                }
              >
                {!featureOn ? "Disabled" : feeEnabled ? "Charged" : "Off"}
              </span>
            </div>
            <div className="set-card-body">
              {/* Master on/off for the whole admin-fee capability (the
                  STORE_ADMIN_FEE entitlement). Saves immediately on toggle. */}
              <div className="set-row">
                <div>
                  <div className="set-row-label">Show admin fee for this store</div>
                  <div className="set-row-help">
                    Master switch for this tenant. When off, no fee is charged, the checkout line is
                    removed everywhere, and the fields below are hidden. Saved fee label and amount
                    are kept and resume when it&apos;s switched back on. Same control as{" "}
                    <Link href={`/admin/tenants/${slug}/features`}>Features → Admin fee</Link>.
                  </div>
                </div>
                <div className="set-row-control">
                  <span
                    className={"switch" + (featureOn ? " on" : "")}
                    role="switch"
                    aria-checked={featureOn}
                    aria-busy={featureSaving}
                    aria-label="Enable the admin fee for this store"
                    tabIndex={0}
                    onClick={toggleAdminFeeFeature}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleAdminFeeFeature();
                      }
                    }}
                  />
                </div>
              </div>
              {/* Shown here (outside the featureOn gate) so a failed/reverted
                  master toggle never collapses silently. */}
              {!featureOn && errors.fee && (
                <div role="alert" className="set-err">
                  {errors.fee}
                </div>
              )}
              {featureOn && (
                <>
              <div className="set-row">
                <div>
                  <div className="set-row-label">Charge an admin fee</div>
                  <div className="set-row-help">
                    When on, the fee below is added once to every new order. Existing orders are
                    never changed.
                  </div>
                </div>
                <div className="set-row-control">
                  <span
                    className={"switch" + (feeEnabled ? " on" : "")}
                    role="switch"
                    aria-checked={feeEnabled}
                    aria-label="Charge an admin fee at checkout"
                    tabIndex={0}
                    onClick={() => {
                      setFeeEnabled((v) => !v);
                      setSaved((s) => ({ ...s, fee: false }));
                      setErrors((e) => ({ ...e, fee: undefined }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setFeeEnabled((v) => !v);
                        setSaved((s) => ({ ...s, fee: false }));
                        setErrors((er) => ({ ...er, fee: undefined }));
                      }
                    }}
                  />
                </div>
              </div>
              {feeEnabled && (
                <>
                  <div className="set-row">
                    <div>
                      <div className="set-row-label">What the fee is for</div>
                      <div className="set-row-help">
                        The line label customers see in the totals, e.g. &ldquo;Processing fee&rdquo; or
                        &ldquo;Service charge&rdquo;.
                      </div>
                    </div>
                    <div className="set-row-control">
                      <input
                        className="input"
                        value={feeLabel}
                        maxLength={ADMIN_FEE_LABEL_MAX}
                        placeholder={ADMIN_FEE_LABEL_DEFAULT}
                        onChange={(e) => {
                          setFeeLabel(e.target.value);
                          setSaved((s) => ({ ...s, fee: false }));
                        }}
                      />
                      <div className="set-counter">
                        {feeLabel.length}/{ADMIN_FEE_LABEL_MAX}
                      </div>
                    </div>
                  </div>
                  <div className="set-row">
                    <div>
                      <div className="set-row-label">How much</div>
                      <div className="set-row-help">
                        A flat amount in the store&apos;s currency, added once per order.
                      </div>
                    </div>
                    <div className="set-row-control">
                      <label className="set-field">
                        <span className="set-sublabel">Amount ({currency})</span>
                        <input
                          className="input mono"
                          type="number"
                          min={0}
                          step="0.01"
                          value={feeAmount}
                          placeholder="0.00"
                          aria-invalid={!feeAmountValid}
                          onChange={(e) => {
                            setFeeAmount(e.target.value);
                            setSaved((s) => ({ ...s, fee: false }));
                            setErrors((er) => ({ ...er, fee: undefined }));
                          }}
                        />
                      </label>
                      {!feeAmountValid && (
                        <div className="set-err">
                          Enter an amount above zero{feeAmountNum > ADMIN_FEE_AMOUNT_MAX ? ` (max ${ADMIN_FEE_AMOUNT_MAX.toLocaleString()})` : ""}, or turn the fee off.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
                </>
              )}
            </div>
            {featureOn && (
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                {feeEnabled && feeAmountValid ? (
                  <>
                    Checkout will show &ldquo;{feePreviewLabel}: {currency}
                    {feeAmountNum.toLocaleString()}&rdquo; above the total.
                  </>
                ) : (
                  <>No fee is charged at checkout.</>
                )}
              </span>
              <div className="set-foot-actions">
                {errors.fee && (
                  <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
                    {errors.fee}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!feeDirty || saving !== null}
                  onClick={() => {
                    setFeeEnabled(baseline.current.feeEnabled);
                    setFeeLabel(baseline.current.feeLabel);
                    setFeeAmount(baseline.current.feeAmount);
                    setErrors((e) => ({ ...e, fee: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={saveFee}
                  disabled={!feeValid || !feeDirty || saving !== null}
                >
                  {saving === "fee" ? "Saving…" : saved.fee && !feeDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save fee"
                  )}
                </button>
              </div>
            </div>
            )}
          </section>

          {/* ---------- checkout copy ---------- */}
          <section className="set-card" ref={refs.copy} data-section="copy">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Checkout</span>
                <h2>Storefront copy</h2>
                <p className="set-desc">
                  The words customers see on the checkout screen, right above the channel buttons.
                </p>
              </div>
            </div>
            <div className="set-card-body">
              <div className="set-row">
                <div>
                  <div className="set-row-label">Checkout title</div>
                  <div className="set-row-help">Shown as the page heading at /checkout.</div>
                </div>
                <div className="set-row-control">
                  <input
                    className="input"
                    value={title}
                    maxLength={CHECKOUT_TITLE_MAX}
                    placeholder="Complete your order"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setSaved((s) => ({ ...s, copy: false }));
                    }}
                  />
                  <div className="set-counter">
                    {title.length}/{CHECKOUT_TITLE_MAX}
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div>
                  <div className="set-row-label">Checkout note</div>
                  <div className="set-row-help">A short helper line under the title. Plain text, no markdown.</div>
                </div>
                <div className="set-row-control">
                  <textarea
                    className="input"
                    style={{ height: "auto", minHeight: 76, padding: "8px 12px", lineHeight: 1.5, resize: "vertical" }}
                    value={note}
                    maxLength={CHECKOUT_NOTE_MAX}
                    placeholder="Shown above the details form"
                    onChange={(e) => {
                      setNote(e.target.value);
                      setSaved((s) => ({ ...s, copy: false }));
                    }}
                  />
                  <div className="set-counter">
                    {note.length}/{CHECKOUT_NOTE_MAX}
                  </div>
                </div>
              </div>
              <div className="set-row">
                <div>
                  <div className="set-row-label">Link preview description</div>
                  <div className="set-row-help">
                    The summary shown when the store link is shared (WhatsApp, social, search).
                    Leave blank for a generic default.
                  </div>
                </div>
                <div className="set-row-control">
                  <textarea
                    className="input"
                    style={{ height: "auto", minHeight: 76, padding: "8px 12px", lineHeight: 1.5, resize: "vertical" }}
                    value={metaDescription}
                    maxLength={META_DESCRIPTION_MAX}
                    placeholder="Premium Peptides, Refined. Elevating expectations through quality, precision, and care."
                    onChange={(e) => {
                      setMetaDescription(e.target.value);
                      setSaved((s) => ({ ...s, copy: false }));
                    }}
                  />
                  <div className="set-counter">
                    {metaDescription.length}/{META_DESCRIPTION_MAX}
                  </div>
                </div>
              </div>
            </div>
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                Saved alongside the channel destinations.
              </span>
              <div className="set-foot-actions">
                {errors.copy && (
                  <span role="alert" className="set-err" style={{ alignSelf: "center" }}>
                    {errors.copy}
                  </span>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!copyDirty || saving !== null}
                  onClick={() => {
                    setTitle(baseline.current.title);
                    setNote(baseline.current.note);
                    setMetaDescription(baseline.current.metaDescription);
                    setErrors((e) => ({ ...e, copy: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={() => saveChannelsAndCopy("copy")}
                  disabled={incompleteChannels.length > 0 || !copyDirty || saving !== null}
                >
                  {saving === "copy" ? "Saving…" : saved.copy && !copyDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save copy"
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ---------- storefront admin access ---------- */}
          <section className="set-card" ref={refs.admin} data-section="admin">
            <div className="set-card-head">
              <div>
                <span className="set-eyebrow">Access</span>
                <h2>Admin access</h2>
                <p className="set-desc">
                  The password the tenant uses to open their store admin at{" "}
                  <code>{domain}/#admin</code>. Share it with the store owner — it&apos;s separate from
                  your platform login.
                </p>
              </div>
              <span className={"badge " + (adminPassword.trim() ? "badge-success" : "badge-neutral")}>
                {adminPassword.trim() ? "Custom password" : "Default password"}
              </span>
            </div>
            <div className="set-card-body">
              {!adminPassword.trim() && (
                <div className="set-notice" style={{ marginBottom: 14 }}>
                  <Ic.AlertCircle />
                  <div>
                    No password set — this admin currently accepts the default <code>admin</code>, which
                    anyone could guess. Set a unique password below.
                  </div>
                </div>
              )}
              <div className="set-row">
                <div>
                  <div className="set-row-label">Admin password</div>
                  <div className="set-row-help">At least 4 characters. Leave blank to fall back to the default.</div>
                </div>
                <div className="set-row-control">
                  <div className="set-field-row">
                    <input
                      className="input mono"
                      type={showAdminPassword ? "text" : "password"}
                      value={adminPassword}
                      placeholder="default: admin"
                      autoComplete="off"
                      onChange={(e) => {
                        setAdminPassword(e.target.value);
                        setSaved((s) => ({ ...s, admin: false }));
                        setErrors((er) => ({ ...er, admin: undefined }));
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowAdminPassword((v) => !v)}
                    >
                      {showAdminPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  {errors.admin && <div className="set-err">{errors.admin}</div>}
                </div>
              </div>
            </div>
            <div className="set-foot">
              <span className="hint">
                <Ic.AlertCircle />
                Takes effect immediately for new admin logins.
              </span>
              <div className="set-foot-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!adminDirty || saving !== null}
                  onClick={() => {
                    setAdminPassword(baseline.current.adminPassword);
                    setErrors((e) => ({ ...e, admin: undefined }));
                  }}
                >
                  Reset
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={saveAdminPassword}
                  disabled={!adminDirty || saving !== null}
                >
                  {saving === "admin" ? "Saving…" : saved.admin && !adminDirty ? (
                    <>
                      <Ic.Check /> Saved
                    </>
                  ) : (
                    "Save password"
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ---------- custom domains (self-contained card) ---------- */}
          {domains}
        </div>
      </div>

      {/* sticky unsaved-changes bar */}
      <div className={"set-savebar" + (anyDirty ? " show" : "")}>
        <span className="msg">
          <span className="dot" />
          You have unsaved changes
        </span>
        <button className="btn btn-sm" onClick={discardAll} disabled={saving !== null}>
          Discard
        </button>
        <button
          className="btn btn-sm btn-accent"
          onClick={saveAll}
          disabled={
            saving !== null ||
            (ordersDirty && !prefixValid) ||
            incompleteChannels.length > 0 ||
            (feeDirty && !feeValid)
          }
        >
          {saving === "all" ? "Saving…" : "Save all changes"}
        </button>
      </div>
    </div>
  );
}
