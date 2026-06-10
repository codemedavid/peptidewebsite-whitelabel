"use client";

// Tweaks panel shell + form controls, ported from the design's tweaks-panel.jsx.
// Adapted for a standalone app: the panel is toggled by an in-app launcher
// (open/onClose props) instead of the design tool's iframe-host postMessage
// protocol. Drag-to-reposition and viewport clamping are preserved.

import {
  useCallback,
  useEffect,
  useId,
  useRef as useReactRef,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { uploadStorefrontImageAction } from "@/actions/media";
import { FONT_PRESETS, FONT_PRESETS_BY_ID, type FontPreset } from "@/lib/theme/fontPresets";
import { fontFamilyValue } from "@/lib/theme/tokens";

// How LogoUpload sends a file. Defaults to the storefront-admin path; the
// platform branding editor passes its own (slug-scoped, operator-authorized)
// uploader so logo uploads work there too — see uploadStorefrontImageAsAdminAction.
export type ImageUploader = (fd: FormData) => Promise<{ url: string } | { error: string }>;

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.92);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}
  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:pointer;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}
  .twk-btn{appearance:none;height:28px;padding:0 12px;border:1px solid transparent;border-radius:7px;
    background:hsl(var(--primary,222 47% 11%));color:hsl(var(--primary-foreground,0 0% 100%));
    font:inherit;font-weight:600;cursor:pointer;transition:background .15s,filter .15s}
  .twk-btn:hover{background:color-mix(in srgb, hsl(var(--primary,222 47% 11%)) 86%, #000)}
  .twk-btn:disabled{opacity:.5;cursor:default}
  .twk-btn.secondary{background:transparent;color:hsl(var(--primary,222 47% 11%));
    border-color:color-mix(in srgb, hsl(var(--primary,222 47% 11%)) 32%, transparent)}
  .twk-btn.secondary:hover{background:color-mix(in srgb, hsl(var(--primary,222 47% 11%)) 8%, transparent)}
  .twk-launch{position:fixed;right:16px;bottom:16px;z-index:2147483645;appearance:none;
    border:.5px solid rgba(255,255,255,.6);border-radius:999px;cursor:pointer;
    padding:10px 16px;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;
    background:linear-gradient(135deg,var(--brand-button,#E94B7D),var(--brand-button-2,#F687A8));
    box-shadow:0 8px 24px -8px rgba(0,0,0,.4);display:inline-flex;align-items:center;gap:8px}
  .twk-launch:hover{filter:brightness(1.05)}

  /* ── Typography accordion: one collapsible card per hero copy element. ──
     Collapsed cards show a name + a compact summary of the type overrides so
     the whole set is scannable at a glance; only the open card expands its
     controls. The active card is lifted with an accent border + glow. */
  .twk-acc{display:flex;flex-direction:column;gap:6px;margin-top:2px}
  .twk-acc-item{position:relative;border:.5px solid rgba(0,0,0,.1);border-radius:10px;
    background:rgba(255,255,255,.4);overflow:hidden;
    transition:border-color .15s,background .15s,box-shadow .15s}
  .twk-acc-item:hover{background:rgba(255,255,255,.62)}
  .twk-acc-item[data-open="1"]{
    border-color:color-mix(in srgb,var(--brand-accent,#E94B7D) 55%,transparent);
    background:rgba(255,255,255,.85);
    box-shadow:0 1px 0 rgba(255,255,255,.6) inset,
      0 10px 24px -16px color-mix(in srgb,var(--brand-accent,#E94B7D) 90%,transparent)}
  .twk-acc-hd{appearance:none;border:0;background:transparent;width:100%;cursor:pointer;
    display:flex;align-items:center;gap:9px;padding:8px 10px;text-align:left;font:inherit;color:inherit}
  .twk-acc-item[data-open="1"] .twk-acc-hd{padding-bottom:7px}
  /* Inset box-shadow (not outline) so the focus ring isn't clipped by the
     card's overflow:hidden. */
  .twk-acc-hd:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--brand-accent,#E94B7D);border-radius:10px}
  .twk-acc-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:transparent;
    border:1px solid rgba(41,38,27,.28);transition:background .15s,border-color .15s}
  .twk-acc-item[data-custom="1"] .twk-acc-dot{background:var(--brand-accent,#E94B7D);border-color:transparent}
  .twk-acc-meta{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
  .twk-acc-name{font-size:11.5px;font-weight:600;letter-spacing:.01em;color:rgba(41,38,27,.9);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-acc-sum{font-size:10px;color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-acc-chev{flex-shrink:0;color:rgba(41,38,27,.4);transition:transform .18s,color .15s}
  .twk-acc-item[data-open="1"] .twk-acc-chev{transform:rotate(180deg);color:rgba(41,38,27,.72)}
  .twk-acc-body{display:flex;flex-direction:column;gap:8px;padding:6px 10px 11px;
    border-top:.5px solid rgba(0,0,0,.06)}
  .twk-acc-reset{align-self:flex-start;appearance:none;border:0;background:transparent;cursor:pointer;
    font:inherit;font-size:10px;font-weight:500;color:rgba(41,38,27,.5);padding:1px 0;margin-top:1px;
    text-decoration:underline;text-underline-offset:2px}
  .twk-acc-reset:hover{color:var(--brand-accent,#E94B7D)}
  .twk-acc-reset:disabled{opacity:.45;color:rgba(41,38,27,.3);cursor:default;text-decoration:none}

  /* ── Global Font Style picker ──────────────────────────────────────────────
     A select-like trigger that expands an inline list of typography presets,
     each previewed in its OWN fonts: the name in the preset's heading face, a
     sample line in the body face, and a CTA chip in the button face. Inline
     (not a floating popover) so it never clips inside the scrollable panel. */
  .twk-fp{display:flex;flex-direction:column;gap:6px}
  .twk-fp-trigger{appearance:none;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:8px;
    text-align:left;padding:7px 9px;border:.5px solid rgba(0,0,0,.1);border-radius:9px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;cursor:pointer;
    transition:border-color .15s,background .15s}
  .twk-fp-trigger:hover{background:rgba(255,255,255,.82)}
  .twk-fp-trigger[data-open="1"]{border-color:color-mix(in srgb,var(--brand-accent,#E94B7D) 55%,transparent);
    background:rgba(255,255,255,.92)}
  .twk-fp-trigger:focus-visible{outline:2px solid var(--brand-accent,#E94B7D);outline-offset:1px}
  .twk-fp-tmain{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
  .twk-fp-tname{font-size:13px;font-weight:600;letter-spacing:.01em;color:rgba(41,38,27,.92);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-fp-tsub{font-size:10px;color:rgba(41,38,27,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-fp-chev{flex-shrink:0;color:rgba(41,38,27,.4);transition:transform .18s}
  .twk-fp-trigger[data-open="1"] .twk-fp-chev{transform:rotate(180deg);color:rgba(41,38,27,.7)}
  .twk-fp-list{display:flex;flex-direction:column;gap:5px;padding:5px;margin-top:1px;
    border:.5px solid rgba(0,0,0,.08);border-radius:10px;background:rgba(255,255,255,.5)}
  .twk-fp-opt{appearance:none;border:.5px solid transparent;border-radius:8px;background:rgba(255,255,255,.55);
    cursor:pointer;display:flex;flex-direction:column;gap:3px;padding:8px 9px;text-align:left;font:inherit;color:inherit;
    transition:border-color .12s,background .12s,box-shadow .12s}
  .twk-fp-opt:hover{background:#fff;border-color:rgba(0,0,0,.1)}
  .twk-fp-opt:focus-visible{outline:2px solid var(--brand-accent,#E94B7D);outline-offset:-1px}
  .twk-fp-opt[data-selected="1"]{border-color:color-mix(in srgb,var(--brand-accent,#E94B7D) 55%,transparent);
    background:#fff;box-shadow:0 6px 16px -12px color-mix(in srgb,var(--brand-accent,#E94B7D) 90%,transparent)}
  .twk-fp-otop{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .twk-fp-oname{font-size:15px;font-weight:600;line-height:1.1;color:rgba(41,38,27,.95);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-fp-ocheck{flex-shrink:0;color:var(--brand-accent,#E94B7D)}
  .twk-fp-odesc{font-size:10px;color:rgba(41,38,27,.5)}
  .twk-fp-oprev{display:flex;align-items:center;gap:8px;margin-top:2px}
  .twk-fp-obody{font-size:12px;color:rgba(41,38,27,.72);line-height:1.2;flex:1;min-width:0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .twk-fp-ochip{flex-shrink:0;font-size:10.5px;font-weight:600;padding:3px 10px;border-radius:999px;color:#fff;
    background:linear-gradient(135deg,var(--brand-button,#E94B7D),var(--brand-button-2,#F687A8));white-space:nowrap}
`;

/** The Tweaks stylesheet — render once near the launcher so it's present
 *  whether or not the panel is open. */
export function TweaksStyle() {
  return <style>{__TWEAKS_STYLE}</style>;
}

// ── Panel shell ───────────────────────────────────────────────────────────
export function TweaksPanel({
  title = "Tweaks",
  open,
  onClose,
  children,
}: {
  title?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dragRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + "px";
    panel.style.bottom = offsetRef.current.y + "px";
  }, []);

  useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", clampToViewport);
      return () => window.removeEventListener("resize", clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  const onDragStart = (e: React.MouseEvent) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: MouseEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <>
      {open ? (
        <div
          ref={dragRef}
          className="twk-panel"
          style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}
        >
          <div className="twk-hd" onMouseDown={onDragStart}>
            <b>{title}</b>
            <button
              className="twk-x"
              aria-label="Close tweaks"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
            >
              ✕
            </button>
          </div>
          <div className="twk-body">{children}</div>
        </div>
      ) : null}
    </>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────
export function TweakSection({ label }: { label: string }) {
  return <div className="twk-sect">{label}</div>;
}

export function TweakRow({
  label,
  value,
  children,
  inline = false,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "twk-row twk-row-h" : "twk-row"}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────
export function TweakToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl">
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="twk-toggle"
        data-on={value ? "1" : "0"}
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  );
}

export function TweakSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </TweakRow>
  );
}

function FontPickerChevron() {
  return (
    <svg className="twk-fp-chev" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.75 6 7.75l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FontPickerCheck() {
  return (
    <svg className="twk-fp-ocheck" width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7.5 5.5 10.5l6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Global Font Style picker ────────────────────────────────────────────────
// A one-click typography preset picker. The trigger reads like a select; opening
// it reveals the presets, each previewed in its OWN fonts (name → heading face,
// sample line → body face, CTA chip → button face) so the tenant can see the
// pairing before applying it. Selecting one calls onChange with the full preset;
// the caller writes heading/body/button onto the brand so every section updates.
// `value` is the id of the matching preset, or null when the current trio is a
// custom mix (shown as "Custom"). Inline-expanding (not a floating menu) so it
// never clips inside the scrollable tweaks panel.
export function FontStylePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (preset: FontPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? FONT_PRESETS_BY_ID[value] : null;
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // It's a disclosure (button → expandable region of preset buttons), not an
  // interactive listbox widget: each option is a real, tab-focusable button, so
  // we keep the ARIA to aria-expanded/aria-controls + aria-current rather than
  // promising listbox roving-focus semantics we don't implement. Escape closes
  // and returns focus to the trigger.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <TweakRow label="Font style">
      <div className="twk-fp" onKeyDown={onKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          className="twk-fp-trigger"
          data-open={open ? "1" : "0"}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="twk-fp-tmain">
            <span
              className="twk-fp-tname"
              style={current ? { fontFamily: fontFamilyValue(current.heading) } : undefined}
            >
              {current ? current.name : "Custom"}
            </span>
            <span className="twk-fp-tsub">
              {current ? current.description : "Mixed fonts — pick a style to unify"}
            </span>
          </span>
          <FontPickerChevron />
        </button>
        {open && (
          <div className="twk-fp-list" id={listId} role="group" aria-label="Font style presets">
            {FONT_PRESETS.map((p) => {
              const selected = p.id === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className="twk-fp-opt"
                  data-selected={selected ? "1" : "0"}
                  onClick={() => {
                    onChange(p);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <span className="twk-fp-otop">
                    <span className="twk-fp-oname" style={{ fontFamily: fontFamilyValue(p.heading) }}>
                      {p.name}
                    </span>
                    {selected && <FontPickerCheck />}
                  </span>
                  <span className="twk-fp-odesc">{p.description}</span>
                  <span className="twk-fp-oprev">
                    <span className="twk-fp-obody" style={{ fontFamily: fontFamilyValue(p.body) }}>
                      Ag — quick brown fox
                    </span>
                    <span className="twk-fp-ochip" style={{ fontFamily: fontFamilyValue(p.button) }}>
                      Shop Now
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </TweakRow>
  );
}

export function TweakText({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <TweakRow label={label}>
      <input
        className="twk-field"
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </TweakRow>
  );
}

export function TweakButton({
  label,
  onClick,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={secondary ? "twk-btn secondary" : "twk-btn"}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

// ── ColorField: swatches + free-form Hex/RGB/HSL input ──────────────────────
export function ColorField({
  label,
  value,
  options = [],
  onChange,
  optional = false,
  fallback = "",
  inheritLabel = "Inheriting default",
  onClear,
}: {
  label: string;
  value?: string;
  options?: string[];
  onChange: (v: string) => void;
  /** When true, an empty/undefined `value` means "inherit": the swatch and the
   *  native picker preview the `fallback` color, the text input is blank with an
   *  inherit placeholder, and a reset link (→ `onClear`) clears the override. */
  optional?: boolean;
  /** The inherited color previewed while no override is set (optional mode). */
  fallback?: string;
  /** Hint/placeholder shown while inheriting, e.g. "Inheriting Surface". */
  inheritLabel?: string;
  /** Clear the override back to inherit. Falls back to onChange("") if omitted. */
  onClear?: () => void;
}) {
  const [input, setInput] = useState(value || "");
  const [invalid, setInvalid] = useState(false);

  // The explicit override ("" = none) and the color actually previewed: the
  // override when set, otherwise the inherited `fallback`. `inheriting` drives
  // the blank input + inherit hint + reset affordance in optional mode.
  const override = value || "";
  const preview = override || fallback;
  const inheriting = optional && !override;
  const clear = () => (onClear ? onClear() : onChange(""));

  useEffect(() => {
    setInput(value || "");
    setInvalid(false);
  }, [value]);

  const isValid = (v: string) => {
    if (!v) return false;
    const probe = document.createElement("div");
    probe.style.color = "";
    probe.style.color = v;
    return probe.style.color !== "";
  };
  const toHex = (v: string) => {
    if (!isValid(v)) return "#000000";
    const probe = document.createElement("div");
    probe.style.color = v;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const m = rgb.match(/\d+(\.\d+)?/g);
    if (!m) return "#000000";
    const [r, g, b] = m.map(Number);
    return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  };

  const commit = (raw: string) => {
    const v = (raw || "").trim();
    if (!v) {
      setInvalid(false);
      return;
    }
    if (isValid(v)) {
      setInvalid(false);
      onChange(v);
    } else {
      setInvalid(true);
    }
  };

  const s: Record<string, CSSProperties> = {
    wrap: { padding: "10px 12px" },
    label: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "rgba(0,0,0,0.6)",
      marginBottom: 6,
    },
    row: { display: "flex", alignItems: "center", gap: 8 },
    swatch: {
      width: 32,
      height: 32,
      borderRadius: 8,
      border: "1px solid rgba(0,0,0,0.1)",
      flexShrink: 0,
      background: isValid(preview) ? preview : "transparent",
      position: "relative",
      overflow: "hidden",
      cursor: "pointer",
    },
    swatchCheck: {
      position: "absolute",
      inset: 0,
      backgroundImage:
        "linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)",
      backgroundSize: "8px 8px",
      backgroundPosition: "0 0, 4px 4px",
      zIndex: -1,
    },
    input: {
      flex: 1,
      minWidth: 0,
      padding: "7px 10px",
      fontSize: 12,
      border: `1px solid ${invalid ? "#c33" : "rgba(0,0,0,0.15)"}`,
      borderRadius: 6,
      fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
      outline: "none",
      background: "#fff",
      color: "rgba(0,0,0,0.85)",
    },
    swatches: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
    reset: { flexShrink: 0, alignSelf: "center", marginTop: 0, whiteSpace: "nowrap" },
    hint: { fontSize: 10, color: invalid ? "#c33" : "rgba(0,0,0,0.5)", marginTop: 4 },
    nativeColor: { width: 0, height: 0, opacity: 0, pointerEvents: "none", position: "absolute" },
  };

  const chipStyle = (c: string, on: boolean): CSSProperties => ({
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: c,
    border: on ? "2px solid #000" : "1px solid rgba(0,0,0,0.15)",
    cursor: "pointer",
    padding: 0,
    boxShadow: on ? "0 0 0 2px #fff inset" : "none",
  });

  return (
    <div style={s.wrap}>
      <div style={s.label}>{label}</div>
      <div style={s.row}>
        <label style={s.swatch} title="Open color picker">
          <span style={s.swatchCheck} />
          <input
            type="color"
            value={toHex(preview || "#000000")}
            onChange={(e) => onChange(e.target.value)}
            style={s.nativeColor}
          />
        </label>
        <input
          style={s.input}
          type="text"
          spellCheck={false}
          value={input}
          placeholder={inheriting ? inheritLabel : "#hex, rgb(), hsl(), oklch()…"}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          onBlur={() => commit(input)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(input);
              e.currentTarget.blur();
            }
          }}
        />
        {optional && override && (
          <button type="button" className="twk-acc-reset" style={s.reset} onClick={clear}>
            Reset
          </button>
        )}
      </div>
      <div style={s.hint}>
        {invalid
          ? "Invalid color. Try #B0345E, rgb(176 52 94), hsl(340 55% 45%), oklch(0.55 0.18 350)"
          : inheriting
            ? inheritLabel
            : "Hex · RGB · HSL · OKLCH · named — any CSS color works."}
      </div>
      {options.length > 0 && (
        <div style={s.swatches}>
          {options.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={c}
              style={chipStyle(c, c.toLowerCase() === override.toLowerCase())}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Logo upload: drag-drop / click-to-pick → ImageKit, persists the hosted URL ─
export function LogoUpload({
  value,
  onChange,
  upload = uploadStorefrontImageAction,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Override the upload transport (platform admin supplies an operator-auth one). */
  upload?: ImageUploader;
}) {
  const inputRef = useReactRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "branding");
      const res = await upload(fd);
      if ("url" in res) onChange(res.url);
      else setError(res.error);
    } catch {
      setError("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  };

  const styles: Record<string, CSSProperties> = {
    wrap: { padding: "8px 12px" },
    row: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: 10,
      border: `1.5px dashed ${dragging ? "var(--brand-accent, #E94B7D)" : "rgba(0,0,0,0.18)"}`,
      borderRadius: 10,
      background: dragging ? "rgba(233,75,125,0.06)" : "rgba(0,0,0,0.02)",
      cursor: "pointer",
      transition: "all .15s",
    },
    preview: {
      width: 44,
      height: 44,
      borderRadius: 8,
      background: "#fff",
      border: "1px solid rgba(0,0,0,0.1)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      flexShrink: 0,
    },
    img: { width: "100%", height: "100%", objectFit: "contain" },
    placeholder: { fontSize: 11, color: "rgba(0,0,0,0.4)", textAlign: "center", lineHeight: 1.2 },
    label: { fontSize: 12, color: "rgba(0,0,0,0.7)", lineHeight: 1.3 },
    labelTitle: { fontWeight: 600, fontSize: 12, marginBottom: 2 },
    btn: {
      fontSize: 11,
      padding: "3px 8px",
      borderRadius: 4,
      border: "1px solid rgba(0,0,0,0.15)",
      background: "#fff",
      cursor: "pointer",
      marginLeft: 8,
    },
    err: { fontSize: 11, color: "#c33", marginTop: 6 },
  };

  return (
    <div style={styles.wrap}>
      <div
        style={styles.row}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div style={styles.preview}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="logo" style={styles.img} />
          ) : (
            <span style={styles.placeholder}>
              No
              <br />
              logo
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.labelTitle}>Logo</div>
          <div style={styles.label}>
            {uploading
              ? "Uploading…"
              : dragging
                ? "Drop image here"
                : "Click or drop an image (PNG/SVG/JPG)"}
          </div>
        </div>
        {value && (
          <button
            style={styles.btn}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            title="Remove logo"
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error && <div style={styles.err}>{error}</div>}
    </div>
  );
}
