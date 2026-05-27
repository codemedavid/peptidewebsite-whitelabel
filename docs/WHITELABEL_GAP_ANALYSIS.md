# White-Label Gap Analysis

Maps the **"SlimDose Rebranding Prompt"** (written for a Vite + React-Router app) onto **this
repo** (Next.js 15 App Router). It exists to decide what's worth building here — no code has
been changed.

**Legend:** ✅ Have · 🟡 Partial · ❌ Missing

> Key translation: the prompt's `useTenant()` client context = this repo's **server-side**
> `getTenantContext()` (React Server Components). The prompt's RLS-first isolation = this repo's
> **`forTenant()` Prisma extension** (primary) + `prisma/rls.sql` (phase-2 backstop). Naming
> differs: prompt themes `clinical-white/midnight-lab/apex-performance` ↔ ours `default/midnight/apex`;
> prompt plans `starter/pro/enterprise` ↔ ours `basic/ecommerce/growth`.

---

## §4.1 TenantConfig shape

| Field | Status | Where / Gap |
|---|---|---|
| `businessName` | ✅ | `Tenant.name`, `TenantSettings.storeName` |
| `tagline` | 🟡 | No dedicated field; lives implicitly in hero section props |
| `slug` | ✅ | `Tenant.slug` (unique), resolves `slug.localhost` |
| `plan` | ✅ | `Plan` relation + entitlements (names differ) |
| `logoUrl` | ✅ | `Branding.logoUrl` (no favicon wiring — see §4.3) |
| `themeId` | ✅ | `Branding.themeId` |
| `theme` color overrides | 🟡 | `Branding.colors` (Json) merged in `resolveCssVars`; **token roles differ** — we use shadcn tokens (`primary`, `background`, `foreground`…), not the prompt's `mainColor/accentColor/buttonColor/buttonTextColor`. No explicit **button≠accent** split or `buttonText`. |
| `theme` font overrides | 🟡 | `Branding.fonts` (Json) → `--font-heading/--font-body`, but fonts are **not dynamically loaded** (see §4.2.1) |
| `features` | ✅ | `FeatureFlag` + plan entitlements + per-tenant overrides (more capable than the prompt's flat map) |
| `orderNumber` format | ❌ | `Order.orderNumber` is an `Int` with `@@unique([tenantId, orderNumber])`, but **no configurable prefix/separator/digits/scheme** (see §7) |
| `currency` / `currencyCode` | 🟡 | `TenantSettings.currency` only; `formatPrice` uses `Intl`. No separate symbol+code pair |
| hero / popup fields | 🟡 | Hero is a **section** in `Page.sections`, not discrete `hero_*` settings; no popup model |
| `communityUrl` | ❌ | Not modeled (could live in `TenantSettings.navigation/footer` Json) |
| `supportEmail` | ✅ | `TenantSettings.supportEmail` |
| `metaTitle` / `metaDescription` | ❌ | `Page.seo` Json exists but storefront `layout`/`generateMetadata` does **not** set per-tenant title/description |

---

## §4.2 Themes via CSS variables

| Item | Status | Notes |
|---|---|---|
| CSS-variable theming (not inline hex) | ✅ | `lib/theme/resolve-css-vars.ts` → inline vars on storefront layout; Tailwind tokens read `hsl(var(--…))` |
| 3 presets | ✅ | `lib/theme/presets.ts`: Clinical White / Midnight Lab / Apex Performance |
| Preset = `{colors, fonts, radius}` | ✅ | (no `shadows` field) |
| `[data-theme]` attribute | 🟡 | We apply inline `style` vars on a wrapper instead of `data-theme` — functionally equivalent |
| Legacy token aliases | n/a | No legacy palette to preserve (greenfield repo) |

---

## §4.2.1 Customizable theme tokens

| Item | Status | Gap |
|---|---|---|
| Per-tenant token overrides | 🟡 | Supported via `Branding.colors`, but token **role names don't match** the prompt (`--theme-main/-accent/-btn/-btn-text/-bg/-sub/-text`). Would need a role mapping or token rename. |
| Button color separate from accent | ❌ | Our `--primary` doubles as button+accent |
| `buttonTextColor` token | 🟡 | `--primary-foreground` exists but isn't exposed as an editable role |
| **Dynamic Google-Fonts loading per tenant** | ❌ | We set `--font-heading/--font-body` but never inject the font `<link>`; `globals.css` hardcodes Inter |
| Auto-derive hover/disabled shades | ❌ | No shade derivation from base colors |
| Admin color-picker + live preview + WCAG contrast hint | ❌ | No branding editor UI exists yet |

---

## §4.2.2 Editable hero (content + typography)

| Item | Status | Gap |
|---|---|---|
| Hero renders (prompt's stub bug) | ✅ | `modules/sections/Hero.tsx` renders fine — the "broken stub" is a SlimDose problem, N/A here |
| Hero content fields (badge/title/subtext/cta/image) | 🟡 | Exist as **section props** in `Page.sections`, not as discrete editable settings; no badge/highlight-word split |
| Hero **typography** controls (font/size/weight/body font/align/highlight color) | ❌ | Not modeled or editable |
| Live preview in wizard | ❌ | Wizard has no preview |

---

## §4.3 Delivery mechanism

| Item | Status | Gap |
|---|---|---|
| Tenant config provider | ✅ | `getTenantContext()` (server) instead of a client `TenantProvider` |
| Resolve by subdomain, server-authoritative | ✅ | `middleware.ts` + `getTenantId()` |
| Apply theme on load | ✅ | storefront layout injects CSS vars |
| Swap **favicon** | ❌ | Not wired |
| Set `document.title` / meta per tenant | ❌ | Root metadata is static; no `generateMetadata` from tenant |
| Replace all hardcoded brand values | ✅ | Greenfield — nothing hardcoded to a brand |
| Wizard persists tenant, resolves `slug.localhost` | ✅ | `/admin/tenants/new` (+ demo file store / `actions/onboarding.ts` for DB) |

---

## §5 Multi-tenant data isolation

| Item | Status | Gap |
|---|---|---|
| `tenant_id` on tenant-owned tables | 🟡 | Present on most; **`OrderItem`/`CartItem` isolate via parent** (no own `tenantId`) — prompt wants it denormalized everywhere |
| `tenant_id` indexed (leading column) | ✅ | All composite indexes lead with `tenantId` |
| App-layer enforcement | ✅ | `forTenant()` extension forces the filter — *stronger* default than hoping every query adds `.eq` |
| **RLS enabled + policies** | ❌ | `prisma/rls.sql` written but **not applied**; Prisma connects privileged and bypasses RLS by default |
| Subdomain resolution authoritative | ✅ | server-side |
| Unknown slug → "store not found" | 🟡 | `/unknown-tenant` exists; **demo mode falls back to `acme`** (prompt forbids fallback in prod — prod path redirects correctly) |
| Storage namespaced per tenant | ❌ | `MediaAsset` + ImageKit auth route exist, but **no `tenant/<id>/` path prefix** or storage policies |
| Admin/auth isolation | ✅ | `getTenantSession()` checks membership vs host; `PlatformUser` (super) vs `TenantUser` (per-tenant) separated |
| Server fns derive tenant from record | n/a | No PayMongo/Telegram/email workers built yet |
| **Isolation test (2 tenants, leak probe)** | ❌ | Not written |

---

## §6 Per-tenant feature toggles

| Item | Status | Gap |
|---|---|---|
| Generalized flag system | ✅ | `lib/features/catalog.ts` + `entitlements.ts` + `FeatureFlag` table |
| Plan = ceiling, toggle = on/off | ✅ | entitlements = plan features ∪ enabled overrides − revocations |
| UI enforcement | ✅ | `<Gate feature=…>` |
| Server enforcement | 🟡 | `requireFeature()` available; not yet called in many actions |
| **Route-guard enforcement** | ❌ | No systematic per-route guard (typing `/coa` etc. isn't blocked) |
| Toggle **catalog breadth** | 🟡 | We have site/ecom/automation keys, but **not** the granular SlimDose list (`calculator`, `orderTracking`, `floatingCart`, `multiCurrency`, `telegramNotify`…) |
| Admin **Features panel** + wizard step | ❌ | No toggle UI |
| Warn before disabling feature with live data | ❌ | Not built |

---

## §7 Per-tenant order-number format

| Item | Status | Gap |
|---|---|---|
| Per-tenant unique order code | ✅ | `@@unique([tenantId, orderNumber])` |
| Configurable `{prefix, separator, scheme, digits}` | ❌ | Not modeled |
| Server-side atomic generation (trigger/Edge fn) | ❌ | No generator; `orderNumber` not auto-filled |
| Sequential per-tenant counter | ❌ | Not built |
| Tracking lookup scoped to tenant | 🟡 | Would come free via `forTenant()` once tracking exists |

---

## §8 UI/UX improvements

| Item | Status | Gap |
|---|---|---|
| Tokenized colors (no inline hex) | ✅ | All components read CSS vars |
| Wizard with **live theme preview** | ❌ | Wizard is functional but static; theme picker shows swatches only |
| Slug validation (format + availability) | 🟡 | Format validated; availability checked on submit, not inline |
| Accessibility pass (contrast, focus, aria) | ❌ | Minimal scaffold |
| Responsive polish / admin tables→cards | 🟡 | Basic responsive; not audited |
| Loading & empty-state skeletons | ❌ | None |
| Reusable themed component library (button/input/card) | 🟡 | `components/ui` exists but mostly empty; styles ad hoc |
| **Monogram logo fallback** | ❌ | Missing logo → renders tenant name text, not an initials monogram |

---

## Summary — what's genuinely missing in *this* repo

Ranked by value for white-label completeness:

1. **Per-tenant SEO + favicon** (§4.3) — `generateMetadata` + favicon swap from tenant config. Small, high-impact.
2. **Order-number format config** (§7) — model `{prefix,separator,scheme,digits}` + a server-side generator. Self-contained.
3. **Branding editor UI** (§4.2.1) — color-picker roles (incl. button≠accent), dynamic Google-Fonts loading, live preview. Biggest visible white-label win.
4. **Feature toggles: route guards + admin panel + broader catalog** (§6) — backend exists; needs UI + per-route enforcement.
5. **Hero typography controls + live preview** (§4.2.2).
6. **RLS activation** (§5.3) — apply `prisma/rls.sql` with a non-privileged role + per-tx tenant GUC. The defense-in-depth backstop.
7. **Storage namespacing per tenant** (§5.4) — ImageKit path prefix `tenant/<id>/`.
8. **Isolation test** (§5.6) — two-tenant leak probe.
9. **UI/UX polish** (§8) — skeletons, a11y, monogram fallback, themed component primitives.

### Already done (no work needed)
Subdomain tenant resolution · CSS-variable theming with 3 presets · plan→entitlements feature
system · `forTenant()` isolation · per-tenant order-number uniqueness · create-tenant wizard ·
section-builder hero · platform-admin vs tenant-admin separation.

### Do NOT do
Edit `Header.tsx`/`Footer.tsx`/`Menu.tsx`/`src/App.tsx`, refactor inline `#3C6CA8`, rebuild the
`Hero.tsx` stub, or rework the `generate_order_number()` SQL migration — **none exist here**.
Those instructions belong to the SlimDose Vite repo.
