// What the catalog shows a visitor locked out of a paid group buy (rules +
// words: ../members-only.ts). `panel` replaces an EMPTY catalog — a
// group-buy-only store — with the round and one Get access door; `notice` is
// the slim line above a grid that still has other products on it. Both lead to
// #groupbuy (the email-only join page). Never shows products or prices: the
// server never sent them.

import type { Brand } from "../types";
import { lockedListingCount, membersOnlyCopy } from "../members-only";

type Teaser = NonNullable<Brand["groupBuyTeaser"]>;

const LockIcon = ({ size }: { size: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="11" width="16" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export function MembersOnlyCatalog({ teaser, variant }: { teaser: Teaser; variant: "panel" | "notice" }) {
  const copy = membersOnlyCopy(teaser);

  if (variant === "notice") {
    const count = lockedListingCount(teaser);
    return (
      <a className="mo-notice" href="#groupbuy">
        <style>{membersOnlyCss}</style>
        <span className="mo-notice__icon"><LockIcon size={16} /></span>
        <span className="mo-notice__text">
          {count ? `${count} more ${count === 1 ? "product is" : "products are"} in ${teaser.name}` : `${teaser.name} has more products`} · members only
        </span>
        <span className="mo-notice__cta">{copy.cta} →</span>
      </a>
    );
  }

  return (
    <div className="mo-panel" role="region" aria-labelledby="mo-panel-title">
      <style>{membersOnlyCss}</style>
      <div className="mo-panel__badge"><LockIcon size={26} /></div>
      <div className="mo-panel__eyebrow eyebrow">{copy.eyebrow}</div>
      <h2 className="mo-panel__title font-display" id="mo-panel-title">{copy.title}</h2>
      <p className="mo-panel__body">{copy.body}</p>
      {!teaser.membership && teaser.steps.length > 0 && (
        <ol className="mo-panel__steps" aria-label="How to get in">
          {teaser.steps.map((s, i) => (
            <li key={`${s}-${i}`}>
              <span className="mo-panel__step-n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      )}
      <a className="btn btn-primary mo-panel__cta" href="#groupbuy">
        <LockIcon size={18} />
        {copy.cta}
      </a>
      <p className="mo-panel__note">{copy.note}</p>
    </div>
  );
}

const membersOnlyCss = `
.sf-root .mo-panel { position: relative; overflow: hidden; max-width: 640px; margin: 8px auto 0; padding: 40px 24px 32px; text-align: center;
  border-radius: var(--radius-lg, 24px); background: var(--brand-surface); border: 1px solid var(--brand-border);
  box-shadow: 0 18px 48px color-mix(in oklab, var(--brand-main) 12%, transparent); }
.sf-root .mo-panel::before { content: ""; position: absolute; inset: 0 0 auto; height: 120px; pointer-events: none;
  background: radial-gradient(120% 100% at 50% 0%, color-mix(in oklab, var(--brand-main) 14%, transparent), transparent 70%); }
.sf-root .mo-panel > * { position: relative; }
.sf-root .mo-panel__badge { width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 20px; display: grid; place-items: center;
  background: var(--brand-main); color: var(--brand-button-text); box-shadow: 0 10px 24px color-mix(in oklab, var(--brand-main) 35%, transparent); transform: rotate(-4deg); }
.sf-root .mo-panel__eyebrow { color: var(--brand-main); }
.sf-root .mo-panel__title { margin: 8px 0 10px; font-size: clamp(26px, 5vw, 36px); line-height: 1.1; color: var(--brand-text); overflow-wrap: anywhere; }
.sf-root .mo-panel__body { margin: 0 auto; max-width: 44ch; font-size: 16px; line-height: 1.55; color: var(--brand-text-muted); }
.sf-root .mo-panel__steps { list-style: none; margin: 22px auto 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.sf-root .mo-panel__steps li { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 7px; border-radius: 99px; font-size: 14px; font-weight: 600;
  color: var(--brand-text); background: color-mix(in oklab, var(--brand-main) 7%, var(--brand-surface)); border: 1px solid color-mix(in oklab, var(--brand-main) 18%, var(--brand-border)); }
.sf-root .mo-panel__step-n { width: 24px; height: 24px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 800;
  background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .mo-panel__cta { margin-top: 26px; min-height: 50px; padding: 0 30px; display: inline-flex; align-items: center; gap: 10px; font-size: 16px; text-decoration: none;
  transition: transform .15s ease, box-shadow .15s ease; }
.sf-root .mo-panel__cta:hover { transform: translateY(-1px); box-shadow: 0 10px 22px color-mix(in oklab, var(--brand-main) 30%, transparent); }
.sf-root .mo-panel__cta:active { transform: translateY(0); }
.sf-root .mo-panel__cta:focus-visible, .sf-root .mo-notice:focus-visible { outline: 2px solid var(--brand-main); outline-offset: 3px; }
.sf-root .mo-panel__note { margin: 14px auto 0; max-width: 40ch; font-size: 13px; line-height: 1.5; color: var(--brand-text-muted); }
@media (max-width: 480px) { .sf-root .mo-panel { padding: 32px 18px 26px; } .sf-root .mo-panel__cta { width: 100%; justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .sf-root .mo-panel__cta { transition: none; } .sf-root .mo-panel__cta:hover { transform: none; } }
.sf-root .mo-notice { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 16px; padding: 12px 16px; border-radius: 14px; text-decoration: none;
  font-size: 14px; color: var(--brand-text); background: color-mix(in oklab, var(--brand-main) 6%, var(--brand-surface));
  border: 1px solid color-mix(in oklab, var(--brand-main) 22%, var(--brand-border)); transition: border-color .15s ease; }
.sf-root .mo-notice:hover { border-color: var(--brand-main); }
.sf-root .mo-notice__icon { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; flex: none; background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .mo-notice__text { flex: 1 1 200px; font-weight: 600; }
.sf-root .mo-notice__cta { font-weight: 800; color: var(--brand-main); white-space: nowrap; }
`;
