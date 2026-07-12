"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/admin/shell/primitives";
import { useAdminUI } from "@/components/admin/shell/AdminShell";
import { formatPesos } from "@/lib/admin/plans";
import {
  ONBOARDING_STATUSES,
  ONBOARDING_STATUS_LABELS,
} from "@/lib/admin/onboarding-types";
import {
  updateOnboardingStatusAction,
  publishTenantAction,
  unpublishTenantAction,
  setStorePasswordAction,
  setTrialAction,
} from "@/actions/admin-onboarding";
import type { OnboardingDetailView } from "@/lib/admin/onboarding-types";

/* ── date helper ── */
function humanDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "YYYY-MM-DD" + 1 month (for the default trial end date). */
function plusOneMonth(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/* ── status badge styling ── */
const STATUS_BADGE_CLS: Record<string, string> = {
  payment_received: "badge-warn",
  tenant_created: "badge-info",
  customizing: "badge-accent",
  revision: "badge-warn",
  completed: "badge-success",
};

/* ── main component ── */
export function OnboardingDetail({ submission }: { submission: OnboardingDetailView }) {
  const router = useRouter();
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();

  // optimistic status so the stepper responds immediately
  const [liveStatus, setLiveStatus] = useState(submission.setupStatus);
  const [livePublished, setLivePublished] = useState(submission.published);

  // ₱699 1-month trial management (pro only) — click the Package stat to edit.
  const isPro = submission.packageKey === "pro";
  const defaultStart = (submission.trialStartsAt ?? submission.createdAt).slice(0, 10);
  const [liveTrial, setLiveTrial] = useState({
    trial: submission.trial,
    startsAt: submission.trialStartsAt,
    endsAt: submission.trialEndsAt,
  });
  const [trialOpen, setTrialOpen] = useState(false);
  const [draftIsTrial, setDraftIsTrial] = useState(submission.trial);
  const [draftStart, setDraftStart] = useState(defaultStart);
  const [draftEnd, setDraftEnd] = useState(
    submission.trialEndsAt?.slice(0, 10) ?? plusOneMonth(defaultStart),
  );

  const statusCls = STATUS_BADGE_CLS[liveStatus] ?? "badge-neutral";
  const storeHref = `https://${submission.url}`;

  /* ── action helpers ── */
  function doStatus(status: string) {
    startTransition(async () => {
      const res = await updateOnboardingStatusAction(
        submission.id,
        status as (typeof ONBOARDING_STATUSES)[number],
      );
      if ("error" in res) {
        showToast(res.error);
      } else {
        setLiveStatus(status);
        showToast(`Status updated to "${ONBOARDING_STATUS_LABELS[status]}"`);
        router.refresh();
      }
    });
  }

  function saveTrial() {
    startTransition(async () => {
      const res = await setTrialAction(
        submission.id,
        draftIsTrial ? { trial: true, startsAt: draftStart, endsAt: draftEnd } : { trial: false },
      );
      if ("error" in res) {
        showToast(res.error);
      } else {
        setLiveTrial(
          draftIsTrial
            ? { trial: true, startsAt: draftStart, endsAt: draftEnd }
            : { trial: false, startsAt: null, endsAt: null },
        );
        setTrialOpen(false);
        showToast(draftIsTrial ? "Saved as ₱699 trial." : "Saved as active (full package).");
        router.refresh();
      }
    });
  }

  function doPublish() {
    startTransition(async () => {
      const res = await publishTenantAction(submission.id);
      if ("error" in res) {
        showToast(res.error);
      } else {
        setLivePublished(true);
        setLiveStatus("completed");
        showToast("Store published and marked completed.");
        router.refresh();
      }
    });
  }

  function doUnpublish() {
    startTransition(async () => {
      const res = await unpublishTenantAction(submission.id);
      if ("error" in res) {
        showToast(res.error);
      } else {
        setLivePublished(false);
        showToast("Store unpublished (hidden from visitors).");
        router.refresh();
      }
    });
  }

  return (
    <div className="page-inner">
      {/* Back nav */}
      <Link href="/onboarding" className="btn btn-ghost btn-sm mb-3" style={{ paddingLeft: 4 }}>
        <Ic.ChevronLeft /> All sign-ups
      </Link>

      {/* ── Header card ── */}
      <div className="card" style={{ marginBottom: 20, overflow: "hidden" }}>
        <div
          style={{
            padding: "20px 24px",
            display: "flex",
            gap: 18,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <BusinessAvatar name={submission.businessName} size={56} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                {submission.businessName}
              </h1>
              <span className={"badge " + statusCls}>
                <span className="bdot" />
                {ONBOARDING_STATUS_LABELS[liveStatus] ?? liveStatus}
              </span>
              {livePublished ? (
                <span className="badge badge-success">
                  <span className="bdot" />
                  Live
                </span>
              ) : (
                <span className="badge badge-neutral">Hidden — not published</span>
              )}
            </div>
            <div className="row" style={{ gap: 16, color: "var(--ink-500)", fontSize: 13, flexWrap: "wrap" }}>
              {livePublished ? (
                <a
                  className="row mono"
                  style={{ gap: 4, color: "var(--accent)" }}
                  href={storeHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  {submission.url} <Ic.External style={{ width: 12, height: 12 }} />
                </a>
              ) : (
                <span className="row mono" style={{ gap: 4, color: "var(--ink-400)" }}>
                  {submission.url}
                  <span className="badge badge-neutral" style={{ marginLeft: 4 }}>
                    hidden
                  </span>
                </span>
              )}
              <span>·</span>
              <span>
                <Ic.Mail style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
                {submission.email}
              </span>
              <span>·</span>
              <span>
                <Ic.Calendar style={{ width: 12, height: 12, verticalAlign: "-2px", marginRight: 4 }} />
                Submitted {humanDate(submission.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Summary metrics strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            borderTop: "1px solid var(--border-soft)",
            background: "var(--bg-canvas)",
          }}
        >
          {[
            {
              label: "Package",
              v: liveTrial.trial
                ? `${submission.packageLabel} — Trial (₱699)`
                : submission.packageLabel,
              sub:
                liveTrial.trial && liveTrial.startsAt && liveTrial.endsAt
                  ? `${humanDate(liveTrial.startsAt)} → ${humanDate(liveTrial.endsAt)}`
                  : isPro
                    ? "Click to manage trial"
                    : undefined,
              onClick: isPro ? () => setTrialOpen((o) => !o) : undefined,
            },
            { label: "Products", v: String(submission.productCount) },
            { label: "Contact", v: submission.contactPerson || "—" },
            {
              label: "Tenant status",
              v: submission.tenantStatus
                ? submission.tenantStatus.replace(/_/g, " ")
                : "Not provisioned",
            },
          ].map((m, i) => (
            <div
              key={i}
              onClick={"onClick" in m ? m.onClick : undefined}
              role={"onClick" in m && m.onClick ? "button" : undefined}
              tabIndex={"onClick" in m && m.onClick ? 0 : undefined}
              onKeyDown={
                "onClick" in m && m.onClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        m.onClick?.();
                      }
                    }
                  : undefined
              }
              title={"onClick" in m && m.onClick ? "Manage trial / billing" : undefined}
              style={{
                padding: "14px 24px",
                borderRight: i < 3 ? "1px solid var(--border-soft)" : "none",
                cursor: "onClick" in m && m.onClick ? "pointer" : "default",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-400)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {m.label}
              </div>
              <div
                style={{ fontSize: 16, fontWeight: 600, marginTop: 4, letterSpacing: "-0.01em" }}
                className="tnum"
              >
                {m.v}
              </div>
              {"sub" in m && m.sub && (
                <div style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>{m.sub}</div>
              )}
            </div>
          ))}
        </div>

        {/* Trial / billing editor — opened by clicking the Package stat (pro only) */}
        {isPro && trialOpen && (
          <div
            style={{
              borderTop: "1px solid var(--border-soft)",
              background: "var(--bg-canvas)",
              padding: "14px 24px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "flex-end",
              gap: 14,
            }}
          >
            <div>
              <span className="field-label">Billing mode</span>
              <div className="row" style={{ gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  className={"btn btn-sm" + (!draftIsTrial ? " btn-accent" : "")}
                  onClick={() => setDraftIsTrial(false)}
                >
                  Active — full package
                </button>
                <button
                  type="button"
                  className={"btn btn-sm" + (draftIsTrial ? " btn-accent" : "")}
                  onClick={() => setDraftIsTrial(true)}
                >
                  Trial — ₱699 / 1 month
                </button>
              </div>
            </div>
            {draftIsTrial && (
              <>
                <div>
                  <label className="field-label" htmlFor="trial-start">
                    Trial starts
                  </label>
                  <input
                    id="trial-start"
                    type="date"
                    className="input"
                    value={draftStart}
                    style={{ marginTop: 4, display: "block" }}
                    onChange={(e) => {
                      setDraftStart(e.target.value);
                      if (e.target.value) setDraftEnd(plusOneMonth(e.target.value));
                    }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="trial-end">
                    Trial ends
                  </label>
                  <input
                    id="trial-end"
                    type="date"
                    className="input"
                    value={draftEnd}
                    min={draftStart}
                    style={{ marginTop: 4, display: "block" }}
                    onChange={(e) => setDraftEnd(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={saveTrial}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setTrialOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid-2">
        {/* LEFT: detail sections */}
        <div className="col" style={{ gap: 16 }}>
          {/* Business card */}
          <DetailCard title="Business" icon="Buildings">
            <InfoGrid
              items={[
                { k: "Business name", v: submission.businessName },
                { k: "Type", v: submission.businessType },
                { k: "Contact person", v: submission.contactPerson || "—" },
                { k: "Email", v: submission.email },
                ...(submission.whatsapp
                  ? [{ k: "WhatsApp", v: submission.whatsapp }]
                  : []),
                ...(submission.facebook
                  ? [{ k: "Facebook", v: submission.facebook }]
                  : []),
              ]}
            />
            {submission.description && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--ink-700)", lineHeight: 1.6 }}>
                {submission.description}
              </div>
            )}
          </DetailCard>

          {/* Order destination */}
          {submission.orderDestination && (
            <DetailCard title="Order Destination" icon="Send">
              <InfoRow label="Type" value={submission.orderDestination} />
              {submission.orderDestinationValue && (
                <InfoRow
                  label="Value"
                  value={
                    submission.orderDestination === "whatsapp" ? (
                      <a
                        href={`https://wa.me/${submission.orderDestinationValue.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}
                        className="mono"
                      >
                        {submission.orderDestinationValue}{" "}
                        <Ic.External style={{ width: 11, height: 11 }} />
                      </a>
                    ) : (
                      <span className="mono">{submission.orderDestinationValue}</span>
                    )
                  }
                />
              )}
            </DetailCard>
          )}

          {/* Starter add-on features */}
          {submission.selectedFeatures.length > 0 && (
            <DetailCard title={`Selected Features (${submission.selectedFeatures.length})`} icon="Sparkles">
              <InfoGrid items={submission.selectedFeatures.map((f) => ({ k: f, v: "Included" }))} />
            </DetailCard>
          )}

          {/* Payment methods */}
          {submission.paymentMethods.length > 0 && (
            <DetailCard title={`Payment Methods (${submission.paymentMethods.length})`} icon="Card">
              <div className="col" style={{ gap: 12 }}>
                {submission.paymentMethods.map((pm, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid var(--border-c)",
                      borderRadius: 10,
                      padding: 14,
                      background: "var(--bg-canvas)",
                    }}
                  >
                    <div
                      style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink-900)", marginBottom: 8 }}
                    >
                      {pm.name}
                    </div>
                    {pm.account && <InfoRow label="Account" value={pm.account} />}
                    {pm.number && <InfoRow label="Number" value={pm.number} />}
                    {pm.instructions && (
                      <div style={{ fontSize: 12.5, color: "var(--ink-500)", marginTop: 6 }}>
                        {pm.instructions}
                      </div>
                    )}
                    {pm.qrUrl && (
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: "var(--ink-400)",
                            marginBottom: 6,
                          }}
                        >
                          QR Code
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={pm.qrUrl}
                          alt={`QR code for ${pm.name}`}
                          style={{
                            width: 80,
                            height: 80,
                            objectFit: "contain",
                            borderRadius: 6,
                            border: "1px solid var(--border-c)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </DetailCard>
          )}

          {/* Products */}
          {submission.products.length > 0 && (
            <DetailCard title={`Products (${submission.products.length})`} icon="ShoppingBag">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {submission.products.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid var(--border-c)",
                      borderRadius: 10,
                      overflow: "hidden",
                      background: "var(--bg-canvas)",
                    }}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div
                        style={{
                          height: 100,
                          background: "var(--bg-active)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--ink-300)",
                        }}
                      >
                        <Ic.Image style={{ width: 24, height: 24 }} />
                      </div>
                    )}
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>
                        {p.name}
                      </div>
                      {p.category && (
                        <div style={{ fontSize: 11.5, color: "var(--ink-400)", marginTop: 2 }}>
                          {p.category}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          marginTop: 4,
                        }}
                        className="tnum"
                      >
                        {formatPesos(p.price * 100)}
                      </div>
                      {p.description && (
                        <div
                          style={{
                            fontSize: 11.5,
                            color: "var(--ink-500)",
                            marginTop: 4,
                            lineHeight: 1.4,
                          }}
                        >
                          {p.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </DetailCard>
          )}

          {/* Proof of payment */}
          {submission.paymentProofUrl && (
            <DetailCard title="Proof of Payment" icon="Image">
              <a href={submission.paymentProofUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={submission.paymentProofUrl}
                  alt="Payment proof"
                  style={{
                    maxWidth: "100%",
                    maxHeight: 320,
                    objectFit: "contain",
                    borderRadius: 8,
                    border: "1px solid var(--border-c)",
                    cursor: "pointer",
                    display: "block",
                  }}
                />
              </a>
              <div style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 8 }}>
                Click image to open full size in a new tab.
              </div>
            </DetailCard>
          )}
        </div>

        {/* RIGHT: workflow + branding */}
        <div className="col" style={{ gap: 16 }}>
          {/* ── Workflow actions ── */}
          <div className="card">
            <div className="card-head">
              <div>
                <h3 className="card-title">Setup Workflow</h3>
                <div className="card-sub">Move this submission through the setup pipeline.</div>
              </div>
            </div>
            <div className="card-body" style={{ padding: 18 }}>
              {/* Stepper */}
              <WorkflowStepper currentStatus={liveStatus} />

              <div className="divider" />

              {/* Status action buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--ink-400)",
                    marginBottom: 4,
                  }}
                >
                  Advance status
                </div>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <button
                    className="btn btn-accent btn-sm"
                    onClick={() => doStatus("customizing")}
                    disabled={pending || liveStatus === "customizing" || liveStatus === "completed"}
                    aria-label="Start Setup — move to Customizing"
                  >
                    <Ic.Wand /> Start Setup
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => doStatus("revision")}
                    disabled={pending || liveStatus === "revision" || liveStatus === "completed"}
                    aria-label="Request Revision — move to Revision Phase"
                  >
                    <Ic.Edit /> Request Revision
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => doStatus("completed")}
                    disabled={pending || liveStatus === "completed"}
                    aria-label="Mark Complete"
                  >
                    <Ic.Check /> Mark Complete
                  </button>
                </div>

                <div className="divider" />

                {/* Publish / Unpublish */}
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--ink-400)",
                    marginBottom: 4,
                  }}
                >
                  Storefront visibility
                </div>
                {!submission.tenantId ? (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--ink-400)",
                      padding: "8px 0",
                    }}
                  >
                    No tenant provisioned yet — provision a tenant first before publishing.
                  </div>
                ) : (
                  <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                    {livePublished ? (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={doUnpublish}
                        disabled={pending}
                        aria-label="Unpublish — hide the store from visitors"
                      >
                        <Ic.Eye /> Unpublish Store
                      </button>
                    ) : (
                      <button
                        className="btn btn-accent btn-sm"
                        onClick={doPublish}
                        disabled={pending}
                        aria-label="Publish — make the store live"
                      >
                        <Ic.Globe /> Publish Store
                      </button>
                    )}
                    {livePublished && (
                      <a
                        className="btn btn-sm"
                        href={storeHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Ic.External /> Open Live Store
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Set store password ── */}
          {submission.slug && (
            <StorePasswordCard slug={submission.slug} url={submission.url} />
          )}

          {/* ── Branding card ── */}
          <DetailCard title="Branding" icon="Image">
            <InfoGrid
              items={[
                ...(submission.themeStyle
                  ? [{ k: "Theme style", v: submission.themeStyle }]
                  : []),
                { k: "Theme ID", v: submission.themeId },
              ]}
            />

            {(submission.primaryColor || submission.secondaryColor) && (
              <div className="row mt-2" style={{ gap: 12, flexWrap: "wrap" }}>
                {submission.primaryColor && (
                  <ColorSwatch label="Primary" hex={submission.primaryColor} />
                )}
                {submission.secondaryColor && (
                  <ColorSwatch label="Secondary" hex={submission.secondaryColor} />
                )}
              </div>
            )}

            {submission.logoUrl && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">Logo</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={submission.logoUrl}
                  alt="Business logo"
                  style={{
                    maxHeight: 64,
                    maxWidth: 180,
                    objectFit: "contain",
                    borderRadius: 6,
                    border: "1px solid var(--border-c)",
                    background: "var(--bg-canvas)",
                    padding: 4,
                  }}
                />
              </div>
            )}

            {submission.bannerUrls.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">Banners ({submission.bannerUrls.length})</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {submission.bannerUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Banner ${i + 1}`}
                        style={{
                          width: 80,
                          height: 50,
                          objectFit: "cover",
                          borderRadius: 6,
                          border: "1px solid var(--border-c)",
                          cursor: "pointer",
                        }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {submission.inspirationUrls.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="field-label">
                  Inspiration ({submission.inspirationUrls.length})
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {submission.inspirationUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Inspiration ${i + 1}`}
                        style={{
                          width: 80,
                          height: 50,
                          objectFit: "cover",
                          borderRadius: 6,
                          border: "1px solid var(--border-c)",
                          cursor: "pointer",
                        }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {submission.inspirationNotes && (
              <div style={{ marginTop: 12 }}>
                <div className="field-label">Inspiration notes</div>
                <div style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.6 }}>
                  {submission.inspirationNotes}
                </div>
              </div>
            )}
          </DetailCard>
        </div>
      </div>
    </div>
  );
}

/* ── Workflow Stepper ── */
function WorkflowStepper({ currentStatus }: { currentStatus: string }) {
  const steps = ONBOARDING_STATUSES as readonly string[];
  const currentIdx = steps.indexOf(currentStatus);
  return (
    <div
      className="stepper"
      style={{ flexWrap: "wrap", gap: "4px 0", overflow: "hidden" }}
      role="list"
      aria-label="Setup workflow steps"
    >
      {steps.map((s, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        return (
          <div
            key={s}
            style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}
            role="listitem"
          >
            <div className={"step" + (isActive ? " active" : isDone ? " done" : "")}>
              <div className="step-dot" aria-hidden="true">
                {isDone ? <Ic.Check /> : i + 1}
              </div>
              <div className="step-label">{ONBOARDING_STATUS_LABELS[s]}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={"step-line" + (isDone || isActive ? " filled" : "")} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Store password card ── */
function StorePasswordCard({ slug, url }: { slug: string; url: string }) {
  const { showToast } = useAdminUI();
  const [pending, startTransition] = useTransition();
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const save = () => {
    setErr(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await setStorePasswordAction(slug, pwd);
      if ("error" in res) {
        setErr(res.error);
      } else {
        setPwd("");
        setSuccess(true);
        showToast("Store password updated.");
      }
    });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 className="card-title">Store Password</h3>
          <div className="card-sub">
            Client signs in at{" "}
            <span className="mono">
              https://{url}/admin
            </span>
          </div>
        </div>
      </div>
      <div className="card-body" style={{ padding: 16 }}>
        <label className="field-label" htmlFor={`pwd-${slug}`}>
          New password (min 6 chars)
        </label>
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <input
            id={`pwd-${slug}`}
            type="password"
            className="input"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pwd.length >= 6) save();
            }}
          />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={save}
            disabled={pending || pwd.length < 6}
            style={{ flexShrink: 0 }}
          >
            {pending ? "Saving…" : "Set password"}
          </button>
        </div>
        {err && (
          <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{err}</div>
        )}
        {success && (
          <div
            style={{
              fontSize: 12,
              color: "var(--success)",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Ic.CheckCircle style={{ width: 12, height: 12 }} /> Password updated successfully.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── helper sub-components ── */

function DetailCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  const IconCmp = Ic[icon] ?? Ic.Activity;
  return (
    <div className="card">
      <div className="card-head">
        <div className="row" style={{ gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "var(--accent-soft)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
              flexShrink: 0,
            }}
          >
            <IconCmp style={{ width: 14, height: 14 }} />
          </div>
          <h3 className="card-title">{title}</h3>
        </div>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function InfoGrid({ items }: { items: { k: string; v: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {items.map(({ k, v }) => (
        <InfoRow key={k} label={k} value={v} />
      ))}
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        padding: "7px 0",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 13,
      }}
    >
      <div style={{ color: "var(--ink-400)" }}>{label}</div>
      <div style={{ color: "var(--ink-900)" }}>{value}</div>
    </div>
  );
}

function ColorSwatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: hex,
          border: "1px solid var(--border-c)",
          flexShrink: 0,
        }}
        aria-label={`${label} color: ${hex}`}
        title={hex}
      />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-700)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-400)" }} className="mono">
          {hex}
        </div>
      </div>
    </div>
  );
}

/* Business avatar — same palette+hash as the list */
const BIZ_COLORS: [string, string][] = [
  ["#2f62f5", "#1b3fa8"],
  ["#16a34a", "#0e7a36"],
  ["#d97706", "#9a5709"],
  ["#7c3aed", "#5b21b6"],
  ["#dc2626", "#991b1b"],
  ["#0891b2", "#155e75"],
  ["#db2777", "#9d174d"],
  ["#65a30d", "#3f6212"],
];
function bizColor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return BIZ_COLORS[h % BIZ_COLORS.length];
}
function bizInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function BusinessAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const [c1, c2] = bizColor(name);
  return (
    <div
      className="tenant-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        fontSize: size >= 40 ? 14 : 11,
        borderRadius: size >= 40 ? 10 : 8,
        flexShrink: 0,
      }}
    >
      {bizInitials(name)}
    </div>
  );
}
