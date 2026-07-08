"use client";

// Storefront Notice Modal — the per-tenant disclaimer/notice shown on every
// visit to the storefront. Two-flag entitlement gate lives in the pure core
// (isNoticeModalVisible): the super admin grants it per tenant AND the store
// owner switches it on. The copy is fully owner-editable (store admin → Notice
// Modal), and the chrome is themed from the tenant's live --brand-* tokens, so
// every tenant's palette flows in automatically.
//
// "Every refresh" behavior: dismissal is component state only (never persisted),
// so the notice re-appears on each full page load, exactly as specified — it
// does NOT re-trigger while navigating between hash routes (this stays mounted).

import { useEffect, useRef, useState } from "react";
import type { Brand } from "../types";
import { type NoticeModalConfig, isNoticeModalVisible } from "@/lib/storefront/notice-modal";

/**
 * The presentational notice card — reused by the live modal (wrapped in the
 * fixed overlay) and by the store-admin editor's live preview (rendered inline).
 * All copy is rendered as React text nodes, so it is HTML-escaped by React.
 */
export function NoticeModalCard({
  config,
  onAgree,
  agreeRef,
}: {
  config: NoticeModalConfig;
  onAgree: () => void;
  agreeRef?: React.Ref<HTMLButtonElement>;
}) {
  const hasWarning = config.warningTitle.length > 0 || config.warningBody.length > 0;
  const hasDelivery = config.deliveryLines.length > 0 || config.deliveryTitle.length > 0;

  return (
    <div
      className="sf-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sf-notice-title"
    >
      <div className="sf-notice__head">
        <div className="sf-notice__icon" aria-hidden="true">
          ⚠️
        </div>
        <div>
          <div className="sf-notice__title" id="sf-notice-title">
            {config.title}
          </div>
          {config.subtitle && <div className="sf-notice__sub">{config.subtitle}</div>}
        </div>
      </div>

      <div className="sf-notice__body">
        {config.bodyParagraphs.map((p, i) => (
          <p key={i} className="sf-notice__p">
            {p}
          </p>
        ))}

        {hasWarning && (
          <div className="sf-notice__warn">
            {config.warningTitle && (
              <div className="sf-notice__warn-title">✕ {config.warningTitle}</div>
            )}
            {config.warningBody && <div className="sf-notice__warn-body">{config.warningBody}</div>}
          </div>
        )}

        {hasDelivery && (
          <div className="sf-notice__delivery">
            {config.deliveryTitle && (
              <div className="sf-notice__delivery-title">🚚 {config.deliveryTitle}</div>
            )}
            {config.deliveryLines.map((line, i) => (
              <p key={i} className="sf-notice__delivery-line">
                {line}
              </p>
            ))}
          </div>
        )}

        <button
          ref={agreeRef}
          type="button"
          className="sf-notice__agree"
          onClick={onAgree}
        >
          🛡 {config.agreeLabel}
        </button>

        {config.footerNote && <div className="sf-notice__footer">{config.footerNote}</div>}
      </div>
    </div>
  );
}

/**
 * The live notice modal mounted in the storefront shell. Renders nothing unless
 * the entitlement gate passes (operator granted AND owner enabled). Guarded by a
 * mounted flag so it never renders during SSR (no hydration flash), closes on Esc
 * / the Agree button, locks body scroll and moves focus into the dialog while open.
 */
export function NoticeModal({ brand }: { brand: Brand }) {
  const config: NoticeModalConfig | undefined = brand.noticeModal;
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const agreeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const open = mounted && !dismissed && isNoticeModalVisible(config);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Move focus into the dialog for keyboard + screen-reader users.
    agreeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || !config) return null;

  return (
    <div className="sf-notice-overlay" role="presentation">
      <NoticeModalCard config={config} onAgree={() => setDismissed(true)} agreeRef={agreeRef} />
    </div>
  );
}
