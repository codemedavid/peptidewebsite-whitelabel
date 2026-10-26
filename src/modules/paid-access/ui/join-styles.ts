// The member's join page styles — the storefront's brand tokens (--brand-*),
// scoped under .sf-root like every storefront component. Mobile first: one
// column, 46px touch targets, 16px inputs (no iOS zoom).

export const paidAccessJoinCss = `
.sf-root .bnnjoin__hero {
  margin: 8px 0 16px; padding: 20px 18px 18px; border-radius: 22px;
  background: var(--brand-main); color: var(--brand-button-text);
  box-shadow: 0 10px 28px color-mix(in oklab, var(--brand-main) 30%, transparent);
}
.sf-root .bnnjoin__hero-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sf-root .bnnjoin__title { margin: 14px 0 12px; font-size: clamp(24px, 6.5vw, 32px); line-height: 1.1; }
.sf-root .bnnjoin__intro { margin: -4px 0 14px; font-size: 15px; line-height: 1.55; white-space: pre-line; }
.sf-root .bnnjoin__way { list-style: none; margin: 0; padding: 12px 0 0; display: flex; flex-wrap: wrap; gap: 6px 4px;
  border-top: 1px solid color-mix(in oklab, var(--brand-button-text) 22%, transparent); font-size: 13px; font-weight: 700; }
.sf-root .bnnjoin__way li { padding: 5px 10px; border-radius: 99px; background: color-mix(in oklab, var(--brand-button-text) 16%, transparent); }
.sf-root .bnnjoin__way li:not(:last-child)::after { content: "→"; margin-left: 8px; opacity: .6; }
.sf-root .bnnjoin__steps { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 8px; }
.sf-root .bnnjoin__step { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; color: var(--brand-text-muted); font-size: 12px; font-weight: 600; }
.sf-root .bnnjoin__dot { width: 30px; height: 30px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 800;
  border: 1.5px solid var(--brand-border); background: var(--brand-surface); transition: background .2s ease, color .2s ease, border-color .2s ease, box-shadow .2s ease; }
.sf-root .bnnjoin__step.is-current { color: var(--brand-text); }
.sf-root .bnnjoin__step.is-current .bnnjoin__dot { border-color: var(--brand-main); color: var(--brand-main); box-shadow: 0 0 0 4px color-mix(in oklab, var(--brand-main) 14%, transparent); }
.sf-root .bnnjoin__step.is-done .bnnjoin__dot { background: var(--brand-main); border-color: var(--brand-main); color: var(--brand-button-text); }
.sf-root .bnnjoin__card { margin-bottom: 12px; padding: 16px; border-radius: 18px; background: var(--brand-surface); border: 1px solid var(--brand-border);
  box-shadow: 0 2px 10px color-mix(in oklab, var(--brand-main) 6%, transparent); }
.sf-root .bnnjoin__skeleton { height: 120px; background: linear-gradient(90deg, var(--brand-surface) 0%, color-mix(in oklab, var(--brand-main) 7%, var(--brand-surface)) 50%, var(--brand-surface) 100%); background-size: 200% 100%; animation: bnnjoin-shimmer 1.2s ease-in-out infinite; }
@keyframes bnnjoin-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .sf-root .bnnjoin__skeleton { animation: none; } }
.sf-root .bnnjoin__h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--brand-text); }
.sf-root .bnnjoin__muted { margin: 0; font-size: 14px; line-height: 1.5; color: var(--brand-text-muted); }
.sf-root .bnnjoin__muted + .bnnjoin__muted { margin-top: 6px; }
.sf-root .bnnjoin__cta { width: 100%; margin-top: 14px; min-height: 46px; }
.sf-root .bnnjoin__alert { border-color: color-mix(in oklab, #c0392b 40%, transparent); background: color-mix(in oklab, #c0392b 7%, var(--brand-surface)); color: var(--brand-text); font-size: 14px; }
.sf-root .bnnjoin__status { border-left: 4px solid var(--brand-main); }
.sf-root .bnnjoin__status.is-success { border-left-color: #1f8a4c; }
.sf-root .bnnjoin__status.is-danger { border-left-color: #c0392b; }
.sf-root .bnnjoin__status.is-neutral { border-left-color: var(--brand-border); }
.sf-root .bnnjoin__status-title { font-size: 16px; font-weight: 700; color: var(--brand-text); margin-bottom: 4px; }
.sf-root .bnnjoin__methods { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 10px; }
.sf-root .bnnjoin__method { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px; border-radius: 14px; background: color-mix(in oklab, var(--brand-main) 5%, var(--brand-surface)); }
.sf-root .bnnjoin__method-name { font-weight: 700; color: var(--brand-text); }
.sf-root .bnnjoin__number { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--brand-text); }
.sf-root .bnnjoin__copy { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 99px; border: 1px solid var(--brand-main); color: var(--brand-main); background: transparent; cursor: pointer; }
.sf-root .bnnjoin__copy:hover { background: color-mix(in oklab, var(--brand-main) 10%, transparent); }
.sf-root .bnnjoin__copy:focus-visible, .sf-root .bnnjoin__drop:focus-visible, .sf-root .bnnjoin__link:focus-visible { outline: 2px solid var(--brand-main); outline-offset: 2px; }
.sf-root .bnnjoin__qr { width: 96px; height: 96px; border-radius: 10px; object-fit: cover; background: #fff; flex: none; }
.sf-root .bnnjoin__form { display: grid; gap: 12px; }
.sf-root .bnnjoin__drop { font: inherit; cursor: pointer; min-height: 132px; border-radius: 14px; padding: 12px;
  border: 1.5px dashed color-mix(in oklab, var(--brand-main) 45%, var(--brand-border)); background: color-mix(in oklab, var(--brand-main) 4%, var(--brand-surface));
  color: var(--brand-text-muted); font-size: 14px; display: grid; place-items: center; transition: border-color .2s ease, background .2s ease; }
.sf-root .bnnjoin__drop:hover { border-color: var(--brand-main); }
.sf-root .bnnjoin__drop.has-file { border-style: solid; padding: 6px; }
.sf-root .bnnjoin__drop img { max-height: 220px; max-width: 100%; border-radius: 10px; object-fit: contain; }
.sf-root .bnnjoin__field { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: var(--brand-text); }
.sf-root .bnnjoin__field em { font-style: normal; font-weight: 500; color: var(--brand-text-muted); }
.sf-root .bnnjoin__field input, .sf-root .bnnjoin__field select, .sf-root .bnnjoin__field textarea {
  font: inherit; font-size: 16px; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--brand-border); background: var(--brand-surface); color: var(--brand-text); }
.sf-root .bnnjoin__field input:focus, .sf-root .bnnjoin__field select:focus, .sf-root .bnnjoin__field textarea:focus { outline: none; border-color: var(--brand-main); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand-main) 18%, transparent); }
.sf-root .bnnjoin__facts { margin: 10px 0 0; display: grid; gap: 10px; }
.sf-root .bnnjoin__facts div { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.sf-root .bnnjoin__facts dt { color: var(--brand-text-muted); }
.sf-root .bnnjoin__facts dd { margin: 0; font-weight: 600; color: var(--brand-text); text-align: right; word-break: break-word; }
.sf-root .bnnjoin__link { margin-top: 12px; font: inherit; font-weight: 700; font-size: 14px; color: var(--brand-main); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.sf-root .bnnjoin__leave { display: block; margin: 4px auto 0; color: var(--brand-text-muted); font-weight: 600; }
.sf-root .bnnjoin__verify { display: grid; gap: 10px; }
.sf-root .bnnjoin__verify-label { font-size: 14px; font-weight: 700; color: var(--brand-text); }
.sf-root .bnnjoin__verify input { font: inherit; font-size: 16px; min-height: 46px; padding: 0 14px; border-radius: 99px; border: 1px solid var(--brand-border);
  background: color-mix(in oklab, var(--brand-main) 3%, var(--brand-surface)); color: var(--brand-text); }
.sf-root .bnnjoin__verify input:focus { outline: none; border-color: var(--brand-main); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand-main) 18%, transparent); }
.sf-root .bnnjoin__verify-btn { min-height: 46px; padding: 0 20px; border-radius: 99px; }
@media (min-width: 640px) {
  .sf-root .bnnjoin__verify { grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 12px 12px 12px 18px; border-radius: 99px; }
}
.sf-root .bnnjoin__hint { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--brand-text-muted); }
.sf-root .bnnjoin__as { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0 0 14px; font-size: 14px; color: var(--brand-text-muted); }
.sf-root .bnnjoin__as strong { color: var(--brand-text); word-break: break-all; }
.sf-root .bnnjoin__as .bnnjoin__link { margin-top: 0; }
.sf-root .bnnjoin__signin { margin-top: 8px; text-align: center; }
.sf-root .bnnjoin__signin .bnnjoin__link { margin-top: 0; }
.sf-root .bnnjoin-strip { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; width: 100%;
  padding: 10px 16px; font: inherit; font-size: 13px; font-weight: 600; border: 0; cursor: pointer; background: var(--brand-main); color: var(--brand-button-text); }
.sf-root .bnnjoin-strip:hover .bnnjoin-strip__cta { text-decoration: underline; }
.sf-root .bnnjoin-strip:focus-visible { outline: 2px solid var(--brand-text); outline-offset: -4px; }
.sf-root .bnnjoin-strip__dot { width: 8px; height: 8px; border-radius: 99px; background: currentColor; opacity: .85; }
.sf-root .bnnjoin-strip__cta { font-weight: 800; }
`;
