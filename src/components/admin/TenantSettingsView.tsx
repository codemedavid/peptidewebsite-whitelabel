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
import { saveOrderFormatAction } from "@/actions/onboarding";
import { saveContactChannelsAction, saveAdminPasswordAction } from "@/actions/branding";
import { CONTACT_CHANNEL_META, META_DESCRIPTION_MAX } from "@/lib/storefront/contact-channels";
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
  /** Storefront-admin password override; blank means the default ("admin"). */
  initialAdminPassword: string;
  lastSaved?: string;
  /** Custom-domain card, rendered in the sections column (its own save flow). */
  domains?: React.ReactNode;
};

const SECTIONS = [
  { id: "orders", label: "Order numbers" },
  { id: "channels", label: "Checkout channels" },
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
  initialAdminPassword,
  lastSaved,
  domains,
}: Props) {
  /* ---------- order-number format ---------- */
  const [prefix, setPrefix] = useState(format.prefix);
  const [separator, setSeparator] = useState(format.separator);
  const [scheme, setScheme] = useState<OrderNumberScheme>(format.scheme);
  const [digits, setDigits] = useState(format.digits);

  /* ---------- channels + checkout copy ---------- */
  const [channels, setChannels] = useState<ContactChannel[]>(initialChannels);
  const [title, setTitle] = useState(initialCheckoutTitle);
  const [note, setNote] = useState(initialCheckoutNote);
  const [metaDescription, setMetaDescription] = useState(initialMetaDescription);

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
    title: initialCheckoutTitle,
    note: initialCheckoutNote,
    metaDescription: initialMetaDescription,
    adminPassword: initialAdminPassword,
  });

  const [saving, setSaving] = useState<SectionId | "all" | null>(null);
  const [saved, setSaved] = useState<Record<SectionId, boolean>>({
    orders: false,
    channels: false,
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
  const copyDirty =
    title !== baseline.current.title ||
    note !== baseline.current.note ||
    metaDescription !== baseline.current.metaDescription;
  const adminDirty = adminPassword !== baseline.current.adminPassword;
  const anyDirty = ordersDirty || channelsDirty || copyDirty || adminDirty;

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
    setTitle(b.title);
    setNote(b.note);
    setMetaDescription(b.metaDescription);
    setAdminPassword(b.adminPassword);
    setErrors({});
  }

  /* ---------- scroll-spy TOC ---------- */
  const refs: Record<SectionId, React.RefObject<HTMLElement | null>> = {
    orders: useRef<HTMLElement>(null),
    channels: useRef<HTMLElement>(null),
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
          disabled={saving !== null || (ordersDirty && !prefixValid) || incompleteChannels.length > 0}
        >
          {saving === "all" ? "Saving…" : "Save all changes"}
        </button>
      </div>
    </div>
  );
}
