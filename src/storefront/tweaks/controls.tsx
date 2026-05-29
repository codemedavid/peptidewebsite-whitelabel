"use client";

// Tweaks panel shell + form controls, ported from the design's tweaks-panel.jsx.
// Adapted for a standalone app: the panel is toggled by an in-app launcher
// (open/onClose props) instead of the design tool's iframe-host postMessage
// protocol. Drag-to-reposition and viewport clamping are preserved.

import {
  useCallback,
  useEffect,
  useRef as useReactRef,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { uploadStorefrontImageAction } from "@/actions/media";

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
}: {
  label: string;
  value: string;
  options?: string[];
  onChange: (v: string) => void;
}) {
  const [input, setInput] = useState(value || "");
  const [invalid, setInvalid] = useState(false);

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
      background: isValid(value) ? value : "transparent",
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
            value={toHex(value || "#000000")}
            onChange={(e) => onChange(e.target.value)}
            style={s.nativeColor}
          />
        </label>
        <input
          style={s.input}
          type="text"
          spellCheck={false}
          value={input}
          placeholder="#hex, rgb(), hsl(), oklch()…"
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
      </div>
      <div style={s.hint}>
        {invalid
          ? "Invalid color. Try #B0345E, rgb(176 52 94), hsl(340 55% 45%), oklch(0.55 0.18 350)"
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
              style={chipStyle(c, c.toLowerCase() === (value || "").toLowerCase())}
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
