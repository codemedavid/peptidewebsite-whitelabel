"use client";

// The branding editor's LIVE PREVIEW: the tenant's real storefront in an
// <iframe> (app/(platform)/admin/preview-frame/[slug]), sized to a real device
// width and scaled to fit, updated as the operator edits.
//
// What it adds over rendering components in the page:
//   • true breakpoints — the frame IS a 390 / 820 / 1280px viewport;
//   • the tenant's actual layout, catalog and page switches, from the server;
//   • any page, browsed in place (the frame keeps its own hash router);
//   • "Click to edit" — pick a part of the site, the editor opens its controls.
//
// Draft edits are posted (debounced) to the frame, which applies them without
// reloading, so the page and scroll position survive typing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Monitor, MousePointerClick, RotateCw, Smartphone, Tablet } from "lucide-react";
import type { Brand } from "@/storefront/types";
import { readPreviewMessage, type PreviewDraftExtras, type PreviewMessage } from "@/lib/admin/preview-draft";
import { isPageVisible } from "@/storefront/visibility";
import "./live-preview.css";

const DEVICES = {
  phone: { width: 390, label: "Phone", Icon: Smartphone },
  tablet: { width: 820, label: "Tablet", Icon: Tablet },
  desktop: { width: 1280, label: "Desktop", Icon: Monitor },
} as const;
type Device = keyof typeof DEVICES;

const SEND_DELAY_MS = 120;

type PageOption = { hash: string; label: string };

/** The pages worth jumping to for this draft — what the store really has. */
function pagesFor(brand: Brand): PageOption[] {
  const dual = brand.homeLayout === "intl-local" && brand.dualMarket === true;
  const pages: PageOption[] = [{ hash: "", label: "Home" }];
  if (dual) {
    pages.push({ hash: "shop-local", label: "Local shop" }, { hash: "shop-international", label: "International shop" });
  } else {
    pages.push({ hash: "catalog", label: "Shop" });
  }
  const extra: PageOption[] = [
    { hash: "faq", label: "FAQ" },
    { hash: "reviews", label: "Reviews" },
    { hash: "protocols", label: "Protocols" },
    { hash: "coa", label: "Lab reports" },
    { hash: "track", label: "Track order" },
    { hash: "articles", label: "Articles" },
    { hash: "groupbuy", label: "Group buy" },
    { hash: "account", label: "Account" },
  ];
  return [...pages, ...extra.filter((p) => isPageVisible(brand, p.hash))];
}

export function LivePreviewStudio({
  slug,
  draft,
  extras,
  previewBrand,
  storefrontUrl,
  onSelectRegion,
  frameSrc,
}: {
  slug: string;
  /** The unsaved config blob — laid over the real store inside the frame. */
  draft: Partial<Brand>;
  extras: PreviewDraftExtras;
  /** The editor's own full Brand view of the draft (for the page list). */
  previewBrand: Brand;
  storefrontUrl: string;
  /** "Click to edit": the region the operator picked in the preview. */
  onSelectRegion?: (region: string) => void;
  /** Override the frame URL (the dev-only sample page uses its own). */
  frameSrc?: string;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Why the frame isn't live yet, read from the frame itself when it loads.
  const [problem, setProblem] = useState<"" | "signin" | "error" | "slow">("");
  const [problemDetail, setProblemDetail] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });

  const send = useCallback((msg: PreviewMessage) => {
    frameRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  // Messages from the frame.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const msg = readPreviewMessage(e, window.location.origin);
      if (!msg) return;
      if (msg.type === "sf-preview:ready") {
        setReady(true);
        setProblem("");
      }
      if (msg.type === "sf-preview:route") setRoute(msg.hash);
      if (msg.type === "sf-preview:select") {
        onSelectRegion?.(msg.region);
        setSelecting(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSelectRegion]);

  // The draft, debounced — and again the moment a (re)loaded frame is ready.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => send({ type: "sf-preview:draft", draft, extras }), SEND_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [ready, draft, extras, send]);

  useEffect(() => {
    if (ready) send({ type: "sf-preview:select-mode", on: selecting });
  }, [ready, selecting, send]);

  // Fit the device width into the column.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setHostSize({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const width = DEVICES[device].width;
  const scale = hostSize.w ? Math.min(1, hostSize.w / width) : 1;
  const frameHeight = hostSize.h ? Math.round(hostSize.h / scale) : 800;
  const pages = useMemo(() => pagesFor(previewBrand), [previewBrand]);
  const reload = () => {
    setReady(false);
    setProblem("");
    setNonce((n) => n + 1);
  };

  // A frame that never says "ready" must not spin forever: look at what it
  // actually loaded (same origin, so its document is readable) and say why.
  const src = frameSrc ?? `/preview-frame/${slug}`;
  const inspectFrame = useCallback(() => {
    try {
      const win = frameRef.current?.contentWindow;
      const doc = frameRef.current?.contentDocument;
      if (!win || !doc) return;
      if (/\/login/.test(win.location.pathname)) {
        setProblem("signin");
        return;
      }
      if (!doc.querySelector(".sf-root")) {
        const heading = doc.querySelector("h1, h2")?.textContent?.trim() || doc.title || "";
        if (heading) {
          setProblem("error");
          setProblemDetail(heading.slice(0, 160));
        }
      }
    } catch {
      setProblem("error");
      setProblemDetail("The preview page couldn't be read.");
    }
  }, []);
  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => {
      inspectFrame();
      setProblem((p) => p || "slow");
    }, 6000);
    return () => window.clearTimeout(t);
  }, [ready, nonce, inspectFrame]);

  return (
    <section className="lps" aria-label="Live preview">
      <div className="lps-bar">
        <span className="lps-live" data-ready={ready ? "1" : "0"}>
          <span aria-hidden /> {ready ? "Live" : "Loading…"}
        </span>
        <div className="lps-seg" role="radiogroup" aria-label="Device">
          {(Object.keys(DEVICES) as Device[]).map((d) => {
            const { Icon, label } = DEVICES[d];
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={device === d}
                aria-label={label}
                title={`${label} · ${DEVICES[d].width}px`}
                className={device === d ? "is-on" : ""}
                onClick={() => setDevice(d)}
              >
                <Icon aria-hidden size={15} />
              </button>
            );
          })}
        </div>
        <select
          className="lps-page"
          aria-label="Page"
          value={pages.some((p) => p.hash === route) ? route : ""}
          onChange={(e) => send({ type: "sf-preview:goto", hash: e.target.value })}
        >
          {pages.map((p) => (
            <option key={p.hash || "home"} value={p.hash}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="lps-spacer" />
        {onSelectRegion && (
          <button
            type="button"
            className={`lps-btn${selecting ? " is-on" : ""}`}
            aria-pressed={selecting}
            title="Click any part of the preview to open its settings"
            onClick={() => setSelecting((v) => !v)}
          >
            <MousePointerClick aria-hidden size={15} /> {selecting ? "Pick a part…" : "Click to edit"}
          </button>
        )}
        <button type="button" className="lps-icon" aria-label="Reload preview" title="Reload preview" onClick={reload}>
          <RotateCw aria-hidden size={15} />
        </button>
        <a className="lps-icon" href={storefrontUrl} target="_blank" rel="noreferrer" aria-label="Open the live store" title="Open the live store">
          <ExternalLink aria-hidden size={15} />
        </a>
      </div>

      <div ref={hostRef} className="lps-host" data-device={device}>
        <div className="lps-device" style={{ width: width * scale, height: hostSize.h || undefined }}>
          <iframe
            key={nonce}
            ref={frameRef}
            title="Storefront preview"
            src={src}
            onLoad={() => window.setTimeout(() => !ready && inspectFrame(), 1500)}
            className="lps-frame"
            style={{ width, height: frameHeight, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      {!ready && problem && (
        <div className="lps-problem" role="status">
          {problem === "signin" ? (
            <>
              <strong>Sign in again to see the preview.</strong> The preview frame was sent to the login page.
            </>
          ) : problem === "error" ? (
            <>
              <strong>The preview page hit an error.</strong> {problemDetail}
            </>
          ) : (
            <>
              <strong>Still loading the store…</strong> The first preview after a restart can take up to a minute in
              development while the storefront builds.
            </>
          )}{" "}
          <a href={src} target="_blank" rel="noreferrer">
            Open the preview on its own
          </a>{" "}
          ·{" "}
          <button type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      <p className="lps-note">
        Your real store with your unsaved changes · {DEVICES[device].label} {width}px
        {scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ""} · checkout is off in the preview
      </p>
    </section>
  );
}
