"use client";

// Form controls for the Website Layout editor. Small, controlled, and built on
// the store admin's existing admin-field / admin-input classes so the editor
// looks like every other admin screen. The two that carry real rules:
//
//   ImageInput  — uploads through the shared uploadStorefrontImageAction (the
//                 tenant's own ImageKit folder; see ./mode) and refuses a source
//                 that would be dropped on save, instead of letting it vanish.
//   LinkEditor  — every destination a link can have, and a plain-language
//                 warning whenever the link would NOT render on the live site
//                 (page switched off, no URL, no contact channel, empty page).

import { useId, useRef, useState, type ReactNode } from "react";
import { useSiteBuilderEnv } from "./env";
import { useUploadImage } from "./mode";
import { heroMediaSrcIssue } from "@/lib/storefront/hero-media";
import {
  IL_LINK_PAGES,
  IL_LINK_SECTIONS,
  IL_LINK_TYPES,
  normalizeLink,
  resolveIlLink,
  type IlLink,
  type IlLinkContext,
  type IlLinkType,
} from "@/lib/storefront/intl-local/links";
import {
  IL_BUTTON_STYLES,
  IL_ICONS,
  IL_LIMITS,
  type IlButton,
  type IlIcon as IlIconName,
  type IlInfoPage,
} from "@/lib/storefront/intl-local/config";
import { IlIcon } from "../../components/intl-local/IlIcon";

export function Group({ title, children, defaultOpen = false, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: string }) {
  return (
    <details className="sb-group" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {badge && <span className="sb-badge">{badge}</span>}
      </summary>
      <div className="sb-group__body">{children}</div>
    </details>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  max = IL_LIMITS.short,
  multiline = false,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  multiline?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="admin-field sb-field">
      <label className="admin-field__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className="admin-textarea" value={value} maxLength={max} rows={3} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="admin-input" value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <div className="admin-field__hint">{hint}</div>}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="sb-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sb-toggle__track" aria-hidden="true" />
      <span className="sb-toggle__text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="admin-field sb-field">
      <label className="admin-field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="admin-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <div className="admin-field__hint">{hint}</div>}
    </div>
  );
}

/** A colour picker. `allowEmpty` adds a "Default" chip that clears it. */
export function ColorInput({
  label,
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = "Default",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const id = useId();
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <div className="admin-field sb-field sb-color">
      <label className="admin-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="sb-color__row">
        <input id={id} type="color" value={hex} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={`${label} colour`} />
        <input className="admin-input" value={value} placeholder={allowEmpty ? emptyLabel : "#RRGGBB"} maxLength={64} onChange={(e) => onChange(e.target.value.trim())} aria-label={`${label} value`} />
        {allowEmpty && value && (
          <button type="button" className="sb-chip" onClick={() => onChange("")}>
            {emptyLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "%",
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="admin-field sb-field sb-slider">
      <label className="admin-field__label" htmlFor={id}>
        {label} <output htmlFor={id}>{value}{suffix}</output>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <div className="admin-field__hint">{hint}</div>}
    </div>
  );
}

/** Formats every browser can display. iPhone HEIC photos are not one of them:
 *  listing these in `accept` also makes iOS convert a HEIC pick to JPEG. */
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";
const DISPLAYABLE = new Set(IMAGE_ACCEPT.split(","));

/** Why a picked file can't be used, or "" when it's fine. */
function imageFileProblem(file: File): string {
  const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
  if (heic) return "iPhone HEIC photos can't be shown on websites. Pick a JPG or PNG (on iPhone: Share → Save as JPEG, or set Camera → Formats → Most Compatible).";
  if (file.type && !DISPLAYABLE.has(file.type)) return "That file type isn't supported — use a JPG, PNG, WebP or GIF image.";
  return "";
}

export function ImageInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const uploadImage = useUploadImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const errId = useId();
  const [busy, setBusy] = useState(false);
  // Shown under the field until the next attempt — a toast that fades is too
  // easy to miss, and a silent failure reads as "the button does nothing".
  const [error, setError] = useState("");

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    const problem = imageFileProblem(file);
    if (problem) {
      setError(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const res = await uploadImage(file);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const issue = heroMediaSrcIssue(res.url);
      if (issue) {
        setError(issue === "too-large" ? "That image is too large to store — try a smaller file." : "That file type isn't supported.");
        return;
      }
      onChange(res.url);
    } catch {
      setError("Upload failed — please check your connection and try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="admin-field sb-field">
      <span className="admin-field__label">{label}</span>
      <div className="sb-image">
        <div className="sb-image__thumb" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="" /> : <span>No image</span>}
        </div>
        <div className="sb-image__actions">
          <button
            type="button"
            className="sb-chip sb-chip--strong"
            disabled={busy}
            aria-describedby={error ? errId : undefined}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button type="button" className="sb-chip" onClick={() => { setError(""); onChange(""); }}>
              Remove
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      {error && (
        <p id={errId} className="sb-warn" role="alert">
          {error}
        </p>
      )}
      {hint && <div className="admin-field__hint">{hint}</div>}
    </div>
  );
}

export function IconPicker({ label = "Icon", value, onChange }: { label?: string; value: IlIconName; onChange: (v: IlIconName) => void }) {
  return (
    <div className="admin-field sb-field">
      <span className="admin-field__label">{label}</span>
      <div className="sb-icons" role="radiogroup" aria-label={label}>
        {IL_ICONS.map((name) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={value === name}
            aria-label={name}
            title={name}
            className={`sb-icons__btn${value === name ? " is-active" : ""}`}
            onClick={() => onChange(name)}
          >
            {name === "none" ? <span className="sb-icons__none">—</span> : <IlIcon name={name} size={20} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<IlLinkType, string> = {
  page: "A page on my store",
  catalog: "My shop (optionally one category)",
  market: "A market's shop (Local or International)",
  section: "A section of my home page",
  url: "A custom link (website, email, phone)",
  contact: "My contact channel",
  info: "An info page (About, Terms…)",
  none: "No link (hide)",
};

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  catalog: "Shop / Catalog",
  reviews: "Reviews",
  faq: "FAQ",
  coa: "Lab results (COA)",
  protocols: "Protocols",
  calculator: "Calculator",
  track: "Track order",
  merchant: "Wholesale",
  articles: "Articles",
  assessment: "Assessment quiz",
  account: "Account (login / sign up)",
  groupbuy: "Group buy",
  "my-groupbuy": "My group buy order",
};

const SECTION_LABELS: Record<string, string> = {
  markets: "Shop your market",
  learn: "Learn & explore",
  community: "Community",
  newsletter: "Newsletter sign-up",
};

export type LinkEnv = { ctx: IlLinkContext; infoPages: IlInfoPage[] };

/** Why a link won't render — or "" when it will. */
export function linkProblem(link: IlLink, env: LinkEnv): string {
  if (resolveIlLink(link, env.ctx)) return "";
  switch (link.type) {
    case "page":
    case "catalog":
      return "That page is switched off on your store, so this link is hidden.";
    case "market":
      return link.market === "international"
        ? "International selling is off (Website Layout → Markets), so this link is hidden."
        : "Your shop page is switched off, so this link is hidden.";
    case "url":
      return link.url.trim() ? "That address isn't a valid link (use https://…, mailto: or tel:)." : "Add a link — it's hidden until then.";
    case "contact":
      return "No contact channel is set up yet, so this is hidden.";
    case "info":
      return "That info page has no text yet, so this link is hidden. Write it under Footer → Info pages.";
    case "none":
      return "No link — this is hidden.";
    default:
      return "This link is hidden.";
  }
}

export function LinkEditor({ label = "Goes to", link, onChange, env }: { label?: string; link: IlLink; onChange: (l: IlLink) => void; env: LinkEnv }) {
  const { categories } = useSiteBuilderEnv();
  const set = (patch: Partial<IlLink>) => onChange(normalizeLink({ ...link, ...patch }));
  const problem = linkProblem(link, env);
  return (
    <div className="sb-link">
      <SelectInput
        label={label}
        value={link.type}
        options={IL_LINK_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
        onChange={(type) => set({ type })}
      />
      {link.type === "page" && (
        <SelectInput
          label="Page"
          value={link.page || "home"}
          options={IL_LINK_PAGES.map((p) => ({
            value: p,
            label: `${PAGE_LABELS[p] ?? p}${env.ctx.isPageVisible(p) ? "" : " (off)"}`,
          }))}
          onChange={(page) => set({ page })}
        />
      )}
      {link.type === "catalog" && (
        <SelectInput
          label="Category"
          value={link.category}
          options={[{ value: "", label: "All products" }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
          onChange={(category) => set({ category })}
        />
      )}
      {link.type === "market" && (
        <SelectInput
          label="Market"
          value={link.market === "international" ? "international" : "local"}
          options={[
            { value: "local", label: "Local shop" },
            { value: "international", label: "International shop (USD)" },
          ]}
          onChange={(market) => set({ market })}
        />
      )}
      {link.type === "section" && (
        <SelectInput
          label="Section"
          value={link.section || "markets"}
          options={IL_LINK_SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] }))}
          onChange={(section) => set({ section })}
        />
      )}
      {link.type === "url" && (
        <TextInput label="Address" value={link.url} max={500} placeholder="https://… · mailto:… · tel:…" onChange={(url) => onChange({ ...link, url })} />
      )}
      {link.type === "info" && (
        <SelectInput
          label="Info page"
          value={link.infoId}
          options={[{ value: "", label: "Choose…" }, ...env.infoPages.map((p) => ({ value: p.id, label: p.title || p.id }))]}
          onChange={(infoId) => set({ infoId })}
        />
      )}
      {problem && (
        <p className="sb-warn" role="note">
          {problem}
        </p>
      )}
    </div>
  );
}

const STYLE_LABELS: Record<string, string> = { solid: "Solid", outline: "Outline", soft: "Soft" };

export function ButtonEditor({ title, btn, onChange, env }: { title: string; btn: IlButton; onChange: (b: IlButton) => void; env: LinkEnv }) {
  const set = (patch: Partial<IlButton>) => onChange({ ...btn, ...patch });
  return (
    <fieldset className="sb-fieldset">
      <legend>{title}</legend>
      <Toggle label="Show this button" checked={btn.show} onChange={(show) => set({ show })} />
      <div className="admin-form__row">
        <TextInput label="Label" value={btn.label} max={IL_LIMITS.label} onChange={(label) => set({ label })} />
        <SelectInput label="Style" value={btn.style} options={IL_BUTTON_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] }))} onChange={(style) => set({ style })} />
      </div>
      <LinkEditor link={btn.link} onChange={(link) => set({ link })} env={env} />
      <div className="admin-form__row">
        <ColorInput label="Button colour" value={btn.color} onChange={(color) => set({ color })} emptyLabel="Theme" />
        <ColorInput label="Button text" value={btn.textColor} onChange={(textColor) => set({ textColor })} emptyLabel="Theme" />
      </div>
    </fieldset>
  );
}

// ── Lists ─────────────────────────────────────────────────────────────────
export function moveItem<T>(arr: readonly T[], from: number, dir: -1 | 1): T[] {
  const to = from + dir;
  if (to < 0 || to >= arr.length) return [...arr];
  const next = [...arr];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function replaceAt<T>(arr: readonly T[], i: number, item: T): T[] {
  return arr.map((x, j) => (j === i ? item : x));
}

export function removeAt<T>(arr: readonly T[], i: number): T[] {
  return arr.filter((_, j) => j !== i);
}

/** A fresh id not already used in `existing`. */
export function newId(prefix: string, existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((e) => e.id));
  let n = existing.length + 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export function RowControls({
  index,
  count,
  onMove,
  onRemove,
  name,
}: {
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onRemove?: () => void;
  name: string;
}) {
  return (
    <div className="sb-rowctl">
      <button type="button" className="sb-iconbtn" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button type="button" className="sb-iconbtn" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
        ↓
      </button>
      {onRemove && (
        <button type="button" className="sb-iconbtn sb-iconbtn--danger" aria-label={`Remove ${name}`} onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}
