// Paid Access admin styles. Scoped under `.sf-root .bnn` so they beat the admin's
// own `.sf-root .admin-*` rules without !important, and ride the store's
// brand tokens (--brand-*) like the rest of #admin.

export const paidAccessAdminCss = `
.sf-root .bnn { display: grid; gap: 22px; }
.sf-root .bnn-round-pick { max-width: 420px; }
.sf-root .bnn-nudge { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 16px; border-radius: 12px; font-size: 14px;
  border: 1px solid color-mix(in oklab, #b45309 35%, transparent); background: color-mix(in oklab, #b45309 9%, transparent); }
.sf-root .bnn-settings { display: grid; gap: 16px; padding: 18px; border-radius: 16px; border: 1px solid var(--brand-border, rgba(0,0,0,.12));
  background: color-mix(in oklab, var(--brand-main, #0a66a1) 3%, var(--brand-surface, #fff)); }
.sf-root .bnn-settings__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.sf-root .bnn-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; align-items: stretch; }
.sf-root .bnn-preset { font: inherit; text-align: left; cursor: pointer; display: grid; gap: 4px; align-content: start; padding: 12px 14px; border-radius: 12px;
  border: 1.5px solid var(--brand-border, rgba(0,0,0,.14)); background: var(--brand-surface, #fff); color: inherit;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.sf-root .bnn-preset:hover { border-color: var(--brand-main, #0a66a1); transform: translateY(-1px); }
.sf-root .bnn-preset:focus-visible { outline: 2px solid var(--brand-main, #0a66a1); outline-offset: 2px; }
.sf-root .bnn-preset.is-active { border-color: var(--brand-main, #0a66a1); box-shadow: 0 0 0 3px color-mix(in oklab, var(--brand-main, #0a66a1) 16%, transparent); }
.sf-root .bnn-preset__name { font-weight: 700; font-size: 14px; }
.sf-root .bnn-preset__desc { font-size: 12.5px; line-height: 1.4; opacity: .72; }
.sf-root .bnn-custom { align-self: center; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--brand-main, #0a66a1); }
.sf-root .bnn-preview { padding: 14px 16px; border-radius: 12px; background: var(--brand-surface, #fff); border: 1px dashed color-mix(in oklab, var(--brand-main, #0a66a1) 40%, transparent); }
.sf-root .bnn-preview__label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .6; margin-bottom: 8px; }
.sf-root .bnn-preview__first { margin: 10px 0 0; font-size: 13px; opacity: .8; }
.sf-root .bnn-flow { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 4px; align-items: center; }
.sf-root .bnn-flow__step { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; padding: 6px 12px 6px 6px; border-radius: 99px;
  background: color-mix(in oklab, var(--brand-main, #0a66a1) 9%, transparent); }
.sf-root .bnn-flow__step:not(:last-child)::after { content: "→"; margin-left: 8px; opacity: .45; }
.sf-root .bnn-flow__step.is-access { background: color-mix(in oklab, #1f8a4c 14%, transparent); }
.sf-root .bnn-flow__n { width: 22px; height: 22px; border-radius: 99px; display: grid; place-items: center; font-size: 11px; font-weight: 800;
  background: var(--brand-main, #0a66a1); color: var(--brand-button-text, #fff); }
.sf-root .bnn-flow__step.is-access .bnn-flow__n { background: #1f8a4c; color: #fff; }
.sf-root .bnn-fieldset { margin: 0; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--brand-border, rgba(0,0,0,.12)); background: var(--brand-surface, #fff); display: grid; gap: 10px; min-width: 0; }
.sf-root .bnn-fieldset__title { padding: 0 6px; margin-left: -6px; font-size: 14px; font-weight: 700; }
.sf-root .bnn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 16px; }
.sf-root .bnn-field { display: grid; gap: 5px; align-content: start; }
.sf-root .bnn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sf-root .bnn-choice { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; min-height: 32px; }
.sf-root .bnn-choice input { width: 17px; height: 17px; flex: none; accent-color: var(--brand-main, #0a66a1); }
.sf-root .bnn-choice:has(input:disabled) { opacity: .55; cursor: not-allowed; }
.sf-root .bnn .admin-input.bnn-num { width: 96px; }
.sf-root .bnn .admin-input.bnn-auto { width: auto; }
.sf-root .bnn-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.sf-root .bnn-steps__row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in oklab, var(--brand-main, #0a66a1) 5%, transparent); }
.sf-root .bnn-steps__n { width: 24px; height: 24px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 800; background: var(--brand-main, #0a66a1); color: var(--brand-button-text, #fff); }
.sf-root .bnn-steps__name { flex: 1; font-weight: 600; }
.sf-root .bnn-icon { font: inherit; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; border: 1px solid var(--brand-border, rgba(0,0,0,.14)); background: var(--brand-surface, #fff); color: inherit; }
.sf-root .bnn-icon:hover:not(:disabled) { border-color: var(--brand-main, #0a66a1); }
.sf-root .bnn-icon:disabled { opacity: .35; cursor: default; }
.sf-root .bnn-icon:focus-visible { outline: 2px solid var(--brand-main, #0a66a1); outline-offset: 1px; }
.sf-root .bnn-questions { display: grid; gap: 10px; }
.sf-root .bnn-question { display: grid; gap: 8px; padding: 10px; border-radius: 10px; border: 1px solid var(--brand-border, rgba(0,0,0,.1)); }
.sf-root .bnn-error { color: #b42318; font-size: 13px; font-weight: 600; }
.sf-root .bnn-alert { padding: 10px 12px; border-radius: 10px; font-size: 14px; background: color-mix(in oklab, #b42318 8%, transparent); border: 1px solid color-mix(in oklab, #b42318 30%, transparent); }
.sf-root .bnn-warn { padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.45; background: color-mix(in oklab, #d97706 10%, transparent); border: 1px solid color-mix(in oklab, #d97706 35%, transparent); }
.sf-root .bnn-settings__save { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; position: sticky; bottom: 0; z-index: 2;
  margin: 0 -18px -18px; padding: 12px 18px; border-radius: 0 0 16px 16px; border-top: 1px solid var(--brand-border, rgba(0,0,0,.12));
  background: color-mix(in oklab, var(--brand-surface, #fff) 92%, transparent); backdrop-filter: blur(6px); }
.sf-root .bnn-skeleton { height: 120px; border-radius: 12px; background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-main, #0a66a1) 8%, transparent), transparent); background-size: 200% 100%; animation: bnn-shimmer 1.2s ease-in-out infinite; }
@keyframes bnn-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .sf-root .bnn-skeleton { animation: none; } .sf-root .bnn-preset:hover { transform: none; } }
@media (max-width: 560px) {
  .sf-root .bnn-settings { padding: 14px; }
  .sf-root .bnn-settings__save { margin: 0 -14px -14px; padding: 10px 14px; }
}
`;
