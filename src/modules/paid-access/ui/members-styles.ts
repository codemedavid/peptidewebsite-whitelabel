// Members tab styles (Admin → Group Buys → Members). Scoped under `.sf-root .pam`
// so they beat the admin's own `.sf-root .admin-*` rules without !important, and
// ride the store's brand tokens (--brand-*) like the rest of #admin.

export const paidAccessMembersCss = `
.sf-root .pam { display: grid; gap: 16px; --pam-main: var(--brand-main, #0a66a1); --pam-line: var(--brand-border, rgba(0,0,0,.12));
  --pam-surface: var(--brand-surface, #fff); --pam-good: #1f8a4c; --pam-warn: #b45309; --pam-bad: #b42318; }
.sf-root .pam-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Round picker */
.sf-root .pam-rounds { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.sf-root .pam-round { font: inherit; font-size: 13.5px; font-weight: 600; flex: none; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px;
  border-radius: 99px; border: 1px solid var(--pam-line); background: var(--pam-surface); color: inherit; cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease; }
.sf-root .pam-round:hover { border-color: var(--pam-main); }
.sf-root .pam-round:focus-visible { outline: 2px solid var(--pam-main); outline-offset: 2px; }
.sf-root .pam-round.is-active { border-color: var(--pam-main); box-shadow: 0 0 0 3px color-mix(in oklab, var(--pam-main) 15%, transparent); }
.sf-root .pam-round__status { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; opacity: .6; }
.sf-root .pam-round__dot { width: 8px; height: 8px; border-radius: 99px; flex: none; background: color-mix(in oklab, currentColor 35%, transparent); }
.sf-root .pam-round__dot[data-status="active"] { background: var(--pam-good); box-shadow: 0 0 0 3px color-mix(in oklab, var(--pam-good) 22%, transparent); }
.sf-root .pam-round__dot[data-status="scheduled"] { background: var(--pam-warn); }

/* Round header */
.sf-root .pam-round-panel { display: grid; gap: 14px; }
.sf-root .pam-hero { display: flex; flex-wrap: wrap; gap: 16px 28px; align-items: flex-end; justify-content: space-between; padding: 18px 20px; border-radius: 16px;
  border: 1px solid var(--pam-line); background: linear-gradient(135deg, color-mix(in oklab, var(--pam-main) 7%, var(--pam-surface)), var(--pam-surface) 70%); }
.sf-root .pam-hero__main { display: grid; gap: 4px; min-width: 0; flex: 1 1 280px; }
.sf-root .pam-hero__eyebrow { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }
.sf-root .pam-hero__eyebrow span { font-weight: 600; letter-spacing: 0; text-transform: none; }
.sf-root .pam-hero__title { margin: 0; font-size: clamp(19px, 1.2rem + .6vw, 24px); line-height: 1.2; font-weight: 800; overflow-wrap: anywhere; }
.sf-root .pam-hero__flow { margin: 2px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 14px; opacity: .85; }
.sf-root .pam-meter { display: grid; gap: 8px; flex: 0 1 260px; min-width: 200px; }
.sf-root .pam-meter__label { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.sf-root .pam-meter__label span { font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 11px; opacity: .6; align-self: center; }
.sf-root .pam-meter__track { height: 8px; border-radius: 99px; overflow: hidden; background: color-mix(in oklab, var(--pam-main) 12%, transparent); }
.sf-root .pam-meter__fill { height: 100%; width: 100%; border-radius: inherit; background: var(--pam-main); transform-origin: left center; transition: transform .4s cubic-bezier(.16,1,.3,1); }
.sf-root .pam-meter__fill[data-full] { background: var(--pam-good); }

/* Notices */
.sf-root .pam-setup, .sf-root .pam-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 16px; border-radius: 12px; font-size: 14px; }
.sf-root .pam-setup { border: 1px dashed color-mix(in oklab, var(--pam-main) 45%, transparent); background: color-mix(in oklab, var(--pam-main) 5%, transparent); }
.sf-root .pam-setup p { margin: 2px 0 0; }
.sf-root .pam-banner { border: 1px solid color-mix(in oklab, var(--pam-warn) 35%, transparent); background: color-mix(in oklab, var(--pam-warn) 9%, transparent); }
.sf-root .pam-alert { padding: 10px 12px; border-radius: 10px; font-size: 14px; background: color-mix(in oklab, var(--pam-bad) 8%, transparent); border: 1px solid color-mix(in oklab, var(--pam-bad) 30%, transparent); }

/* Toolbar: buckets + search */
.sf-root .pam-toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; }
.sf-root .pam-buckets { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: color-mix(in oklab, var(--pam-main) 6%, transparent);
  overflow-x: auto; max-width: 100%; scrollbar-width: none; }
.sf-root .pam-buckets::-webkit-scrollbar { display: none; }
.sf-root .pam-bucket { font: inherit; font-size: 13.5px; font-weight: 600; flex: none; display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px;
  border-radius: 9px; border: 0; background: transparent; color: inherit; opacity: .75; cursor: pointer; transition: background .15s ease, opacity .15s ease; }
.sf-root .pam-bucket:hover { opacity: 1; }
.sf-root .pam-bucket:focus-visible { outline: 2px solid var(--pam-main); outline-offset: 1px; }
.sf-root .pam-bucket.is-active { opacity: 1; background: var(--pam-surface); box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 0 0 1px var(--pam-line); }
.sf-root .pam-bucket__n { min-width: 20px; padding: 1px 6px; border-radius: 99px; font-size: 11.5px; font-weight: 700; text-align: center;
  background: color-mix(in oklab, currentColor 10%, transparent); font-variant-numeric: tabular-nums; }
.sf-root .pam-bucket.is-urgent .pam-bucket__n { background: var(--pam-warn); color: #fff; }
.sf-root .pam-toolbar__side { display: flex; gap: 8px; align-items: center; flex: 1 1 260px; justify-content: flex-end; }
.sf-root .pam-search { position: relative; display: flex; align-items: center; flex: 1 1 200px; max-width: 280px; }
.sf-root .pam-search svg { position: absolute; left: 11px; opacity: .5; pointer-events: none; }
.sf-root .pam-search input { font: inherit; font-size: 14px; width: 100%; min-width: 0; height: 38px; padding: 0 12px 0 34px; border-radius: 10px;
  border: 1px solid var(--pam-line); background: var(--pam-surface); color: inherit; }
.sf-root .pam-search input:focus { outline: none; border-color: var(--pam-main); box-shadow: 0 0 0 3px color-mix(in oklab, var(--pam-main) 15%, transparent); }
.sf-root .pam-refresh { font: inherit; font-size: 12.5px; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border-radius: 10px;
  border: 1px solid var(--pam-line); background: var(--pam-surface); color: inherit; opacity: .8; cursor: pointer; }
.sf-root .pam-refresh:hover { opacity: 1; border-color: var(--pam-main); }
.sf-root .pam-refresh:active svg { transform: rotate(90deg); }
.sf-root .pam-refresh svg { transition: transform .3s ease; }
.sf-root .pam-refresh:focus-visible { outline: 2px solid var(--pam-main); outline-offset: 2px; }

/* List + cards */
.sf-root .pam-list { display: grid; gap: 12px; }
.sf-root .pam-card { position: relative; display: grid; gap: 12px; padding: 16px 18px; border-radius: 14px; border: 1px solid var(--pam-line); background: var(--pam-surface);
  box-shadow: 0 1px 2px rgba(0,0,0,.04); transition: box-shadow .15s ease; }
.sf-root .pam-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.06); }
.sf-root .pam-card.is-waiting { border-color: color-mix(in oklab, var(--pam-warn) 40%, var(--pam-line)); }
.sf-root .pam-card.is-waiting::before { content: ""; position: absolute; left: -1px; top: 14px; bottom: 14px; width: 4px; border-radius: 0 4px 4px 0; background: var(--pam-warn); }
.sf-root .pam-card__head { display: flex; align-items: center; gap: 12px; }
.sf-root .pam-avatar { width: 40px; height: 40px; flex: none; border-radius: 99px; display: grid; place-items: center; font-weight: 800; font-size: 16px;
  color: var(--pam-main); background: color-mix(in oklab, var(--pam-main) 12%, transparent); }
.sf-root .pam-card__who { min-width: 0; flex: 1; }
.sf-root .pam-card__name { font-weight: 700; font-size: 15.5px; overflow-wrap: anywhere; }
.sf-root .pam-card__sub { font-size: 13px; opacity: .65; overflow-wrap: anywhere; }
.sf-root .pam-status { flex: none; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px;
  background: color-mix(in oklab, currentColor 9%, transparent); }
.sf-root .pam-status[data-tone="attention"] { color: var(--pam-warn); background: color-mix(in oklab, var(--pam-warn) 12%, transparent); }
.sf-root .pam-status[data-tone="good"] { color: var(--pam-good); background: color-mix(in oklab, var(--pam-good) 12%, transparent); }
.sf-root .pam-status[data-tone="bad"] { color: var(--pam-bad); background: color-mix(in oklab, var(--pam-bad) 10%, transparent); }
.sf-root .pam-status[data-tone="info"] { color: var(--pam-main); background: color-mix(in oklab, var(--pam-main) 10%, transparent); }
.sf-root .pam-status[data-tone="muted"] { opacity: .7; }

.sf-root .pam-pay { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 12px 14px; border-radius: 12px;
  background: color-mix(in oklab, var(--pam-main) 4%, transparent); border: 1px solid color-mix(in oklab, var(--pam-main) 10%, transparent); }
.sf-root .pam-pay__amount { display: grid; font-size: 22px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.sf-root .pam-pay__kind { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .55; }
.sf-root .pam-pay__facts { margin: 0; display: flex; flex-wrap: wrap; gap: 8px 24px; flex: 1 1 220px; }
.sf-root .pam-pay__facts div { display: grid; gap: 2px; }
.sf-root .pam-pay__facts dt { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .55; }
.sf-root .pam-pay__facts dd { margin: 0; font-size: 14px; display: grid; gap: 2px; }
.sf-root .pam-mono { font-family: ui-monospace, SF Mono, Menlo, monospace; font-size: 13.5px; letter-spacing: .02em; overflow-wrap: anywhere; }
.sf-root .pam-dupe { font-size: 12px; font-weight: 700; color: var(--pam-warn); }
.sf-root .pam-link { font: inherit; font-size: 13.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; padding: 4px 2px; border: 0; background: none;
  color: var(--pam-main); cursor: pointer; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.sf-root .pam-link:hover { text-decoration-thickness: 2px; }
.sf-root .pam-link:focus-visible { outline: 2px solid var(--pam-main); outline-offset: 2px; border-radius: 4px; }
.sf-root .pam-notes { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.sf-root .pam-notes li { font-size: 12.5px; padding: 4px 10px; border-radius: 8px; background: color-mix(in oklab, currentColor 6%, transparent); }
.sf-root .pam-answers { margin: 0; display: grid; gap: 8px; padding: 10px 12px; border-radius: 10px; background: color-mix(in oklab, var(--pam-main) 5%, transparent); }
.sf-root .pam-answers div { display: grid; gap: 2px; }
.sf-root .pam-answers dt { font-size: 12px; font-weight: 700; opacity: .65; }
.sf-root .pam-answers dd { margin: 0; font-size: 14px; overflow-wrap: anywhere; }

.sf-root .pam-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.sf-root .pam-actions__quiet { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-right: auto; }
.sf-root .pam-text-btn { font: inherit; font-size: 13.5px; font-weight: 600; padding: 6px 2px; border: 0; background: none; color: inherit; opacity: .7; cursor: pointer; }
.sf-root .pam-text-btn:hover { opacity: 1; text-decoration: underline; text-underline-offset: 3px; }
.sf-root .pam-text-btn.is-danger { color: var(--pam-bad); opacity: .85; }
.sf-root .pam-text-btn:focus-visible { outline: 2px solid var(--pam-main); outline-offset: 2px; border-radius: 4px; }
.sf-root .pam .admin-btn.pam-primary { min-width: 150px; font-weight: 700; }
.sf-root .pam .admin-btn.pam-danger { background: var(--pam-bad); border-color: var(--pam-bad); color: #fff; }
.sf-root .pam .admin-btn.pam-danger:hover:not(:disabled) { background: #912018; border-color: #912018; }
.sf-root .pam-prompt { display: grid; gap: 8px; padding: 12px; border-radius: 12px; background: color-mix(in oklab, currentColor 4%, transparent); }
.sf-root .pam-history summary { cursor: pointer; font-size: 13px; font-weight: 600; opacity: .7; width: fit-content; }
.sf-root .pam-history summary:hover { opacity: 1; }
.sf-root .pam-history ol { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; }

/* Empty + loading */
.sf-root .pam-empty { display: grid; justify-items: center; gap: 6px; padding: 36px 16px; text-align: center; border-radius: 14px; border: 1px dashed var(--pam-line); }
.sf-root .pam-empty__title { margin: 0; font-weight: 700; font-size: 15px; }
.sf-root .pam-empty.is-done { border-style: solid; border-color: color-mix(in oklab, var(--pam-good) 30%, transparent); background: color-mix(in oklab, var(--pam-good) 5%, transparent); }
.sf-root .pam-empty.is-done .pam-empty__title::before { content: "✓"; display: block; margin: 0 auto 6px; width: 34px; height: 34px; line-height: 34px; border-radius: 99px;
  color: #fff; background: var(--pam-good); }
.sf-root .pam-skeleton { height: 132px; border-radius: 14px; background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--pam-main) 8%, transparent), transparent);
  background-size: 200% 100%; animation: pam-shimmer 1.2s ease-in-out infinite; }
@keyframes pam-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

@media (prefers-reduced-motion: reduce) {
  .sf-root .pam-skeleton { animation: none; }
  .sf-root .pam-meter__fill, .sf-root .pam-refresh svg { transition: none; }
}
@media (max-width: 560px) {
  .sf-root .pam-hero { padding: 16px; }
  .sf-root .pam-meter { flex-basis: 100%; }
  .sf-root .pam-card { padding: 14px; }
  .sf-root .pam-toolbar__side { justify-content: stretch; }
  .sf-root .pam-search { max-width: none; }
  .sf-root .pam-refresh span { display: none; }
  .sf-root .pam-actions { justify-content: stretch; }
  .sf-root .pam-actions__quiet { flex-basis: 100%; }
  .sf-root .pam-actions .admin-btn { flex: 1 1 auto; }
}
`;
