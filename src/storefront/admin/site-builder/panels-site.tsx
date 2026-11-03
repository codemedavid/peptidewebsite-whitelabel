"use client";

// Website Layout editor — the SITE-WIDE panels: General (theme + type),
// Header & navigation (top bar, header, the menu builder) and Footer (footer,
// socials, floating contact, info pages). Each panel edits its slice of the
// draft IntlLocalConfig through `update`, never mutating it.

import type { Brand } from "../../types";
import {
  IL_LIMITS,
  IL_SOCIAL_PLATFORMS,
  type IlInfoPage,
  type IlNavChild,
  type IlNavItem,
  type IlSocial,
  type IntlLocalConfig,
} from "@/lib/storefront/intl-local/config";
import { NO_LINK } from "@/lib/storefront/intl-local/links";
import { FONT_OPTIONS } from "@/lib/theme/tokens";
import { BackgroundEditor } from "./BackgroundEditor";
import {
  ColorInput,
  Group,
  IconPicker,
  ImageInput,
  LinkEditor,
  RowControls,
  SelectInput,
  Slider,
  TextInput,
  Toggle,
  moveItem,
  newId,
  removeAt,
  replaceAt,
  type LinkEnv,
} from "./fields";

export type PanelProps = {
  cfg: IntlLocalConfig;
  update: (fn: (c: IntlLocalConfig) => IntlLocalConfig) => void;
  env: LinkEnv;
  brand: Brand;
};

const FONT_CHOICES = [{ value: "", label: "My store's font" }, ...FONT_OPTIONS.map((f) => ({ value: f, label: f }))];

export function GeneralPanel({ cfg, update, brand }: PanelProps) {
  const t = cfg.theme;
  const setTheme = (patch: Partial<IntlLocalConfig["theme"]>) => update((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const setHeader = (patch: Partial<IntlLocalConfig["header"]>) => update((c) => ({ ...c, header: { ...c.header, ...patch } }));
  return (
    <>
      <Group title="Website name & logo" defaultOpen>
        <TextInput
          label="Website name"
          value={cfg.header.brandName}
          placeholder={brand.name}
          hint="Leave blank to use your store name."
          onChange={(brandName) => setHeader({ brandName })}
        />
        <Toggle label="Show logo" checked={cfg.header.showLogo} onChange={(showLogo) => setHeader({ showLogo })} />
        <ImageInput label="Logo" value={cfg.header.logoUrl} hint="Leave empty to use your store logo. Wide logos keep their shape." onChange={(logoUrl) => setHeader({ logoUrl })} />
        {cfg.header.showLogo && (
          <Slider label="Logo size" value={cfg.header.logoHeight} min={24} max={96} suffix="px" onChange={(logoHeight) => setHeader({ logoHeight })} />
        )}
      </Group>

      <Group title="Colours" defaultOpen>
        <Toggle
          label="Use my store's brand colours"
          checked={t.useBrandColors}
          hint="Off = the colours below. Each card and section can still have its own background."
          onChange={(useBrandColors) => setTheme({ useBrandColors })}
        />
        {!t.useBrandColors && (
          <div className="sb-grid2">
            <ColorInput label="Page background" value={t.pageBg} allowEmpty={false} onChange={(pageBg) => setTheme({ pageBg })} />
            <ColorInput label="Surfaces (menus, inputs)" value={t.surface} allowEmpty={false} onChange={(surface) => setTheme({ surface })} />
            <ColorInput label="Text" value={t.ink} allowEmpty={false} onChange={(ink) => setTheme({ ink })} />
            <ColorInput label="Muted text" value={t.muted} allowEmpty={false} onChange={(muted) => setTheme({ muted })} />
            <ColorInput label="Accent (buttons, links)" value={t.accent} allowEmpty={false} onChange={(accent) => setTheme({ accent })} />
            <ColorInput label="Text on accent" value={t.accentText} allowEmpty={false} onChange={(accentText) => setTheme({ accentText })} />
          </div>
        )}
      </Group>

      <Group title="Typography">
        <div className="admin-form__row">
          <SelectInput label="Heading font" value={t.headingFont} options={FONT_CHOICES} onChange={(headingFont) => setTheme({ headingFont })} />
          <SelectInput label="Body font" value={t.bodyFont} options={FONT_CHOICES} onChange={(bodyFont) => setTheme({ bodyFont })} />
        </div>
        <div className="admin-form__row">
          <SelectInput
            label="Heading weight"
            value={String(t.headingWeight)}
            options={["500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))}
            onChange={(w) => setTheme({ headingWeight: Number(w) })}
          />
          <SelectInput
            label="Text size"
            value={t.scale}
            options={[
              { value: "sm", label: "Small" },
              { value: "md", label: "Medium" },
              { value: "lg", label: "Large" },
            ]}
            onChange={(scale) => setTheme({ scale })}
          />
        </div>
      </Group>

      <Group title="Shape & spacing">
        <Slider label="Corner rounding" value={t.radius} min={0} max={40} suffix="px" onChange={(radius) => setTheme({ radius })} />
        <SelectInput
          label="Space between sections"
          value={t.spacing}
          options={[
            { value: "compact", label: "Compact" },
            { value: "cozy", label: "Cozy" },
            { value: "roomy", label: "Roomy" },
          ]}
          onChange={(spacing) => setTheme({ spacing })}
        />
      </Group>
    </>
  );
}

function ChildRow({
  child,
  index,
  count,
  env,
  onChange,
  onMove,
  onRemove,
}: {
  child: IlNavChild;
  index: number;
  count: number;
  env: LinkEnv;
  onChange: (c: IlNavChild) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`sb-row${child.show ? "" : " is-off"}`}>
      <div className="sb-row__head">
        <Toggle label="" checked={child.show} onChange={(show) => onChange({ ...child, show })} />
        <input
          className="admin-input sb-row__title"
          aria-label="Link text"
          value={child.label}
          maxLength={IL_LIMITS.label}
          onChange={(e) => onChange({ ...child, label: e.target.value })}
        />
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={child.label || "link"} />
      </div>
      <LinkEditor link={child.link} onChange={(link) => onChange({ ...child, link })} env={env} />
    </div>
  );
}

/** Editable list of simple links — dropdown entries and footer links. */
export function LinkList({
  items,
  onChange,
  env,
  max,
  addLabel,
  idPrefix,
}: {
  items: IlNavChild[];
  onChange: (items: IlNavChild[]) => void;
  env: LinkEnv;
  max: number;
  addLabel: string;
  idPrefix: string;
}) {
  return (
    <div className="sb-list">
      {items.map((child, i) => (
        <ChildRow
          key={child.id}
          child={child}
          index={i}
          count={items.length}
          env={env}
          onChange={(c) => onChange(replaceAt(items, i, c))}
          onMove={(dir) => onChange(moveItem(items, i, dir))}
          onRemove={() => onChange(removeAt(items, i))}
        />
      ))}
      {items.length < max && (
        <button
          type="button"
          className="sb-add"
          onClick={() => onChange([...items, { id: newId(idPrefix, items), show: true, label: "New link", link: { ...NO_LINK, type: "page", page: "home" } }])}
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}

function NavItemEditor({
  item,
  index,
  count,
  env,
  onChange,
  onMove,
  onRemove,
}: {
  item: IlNavItem;
  index: number;
  count: number;
  env: LinkEnv;
  onChange: (i: IlNavItem) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <Group title={item.label || "Menu"} badge={item.show ? `${item.children.length} links` : "Hidden"}>
      <div className="sb-row__head">
        <Toggle label="Show in menu" checked={item.show} onChange={(show) => onChange({ ...item, show })} />
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={item.label || "menu"} />
      </div>
      <TextInput label="Menu title" value={item.label} max={IL_LIMITS.label} onChange={(label) => onChange({ ...item, label })} />
      {item.children.length === 0 && (
        <LinkEditor label="Menu title goes to" link={item.link} onChange={(link) => onChange({ ...item, link })} env={env} />
      )}
      <p className="sb-sub">Dropdown links {item.children.length === 0 && "(none — the title is a plain link)"}</p>
      <LinkList
        items={item.children}
        onChange={(children) => onChange({ ...item, children })}
        env={env}
        max={IL_LIMITS.navChildren}
        addLabel="Add dropdown link"
        idPrefix={`${item.id}-link`}
      />
    </Group>
  );
}

export function HeaderPanel({ cfg, update, env }: PanelProps) {
  const setTop = (patch: Partial<IntlLocalConfig["topBar"]>) => update((c) => ({ ...c, topBar: { ...c.topBar, ...patch } }));
  const setHeader = (patch: Partial<IntlLocalConfig["header"]>) => update((c) => ({ ...c, header: { ...c.header, ...patch } }));
  const setNav = (nav: IlNavItem[]) => update((c) => ({ ...c, nav }));
  return (
    <>
      <Group title="Top bar" badge={cfg.topBar.show ? "On" : "Off"}>
        <Toggle label="Show the top bar" checked={cfg.topBar.show} onChange={(show) => setTop({ show })} />
        <TextInput label="Message" value={cfg.topBar.text} max={IL_LIMITS.long} onChange={(text) => setTop({ text })} />
        <TextInput
          label="Subscribe link text"
          value={cfg.topBar.subscribeLabel}
          max={IL_LIMITS.label}
          hint="Scrolls to the newsletter section. Leave blank to hide."
          onChange={(subscribeLabel) => setTop({ subscribeLabel })}
        />
        <Toggle label="Show social icons" checked={cfg.topBar.showSocials} onChange={(showSocials) => setTop({ showSocials })} />
        <ColorInput label="Text colour" value={cfg.topBar.textColor} onChange={(textColor) => setTop({ textColor })} />
        <BackgroundEditor value={cfg.topBar.background} textColor={cfg.topBar.textColor} onChange={(background) => setTop({ background })} />
      </Group>

      <Group title="Header style">
        <div className="admin-form__row">
          <ColorInput label="Header background" value={cfg.header.bgColor} onChange={(bgColor) => setHeader({ bgColor })} />
          <ColorInput label="Header text" value={cfg.header.textColor} onChange={(textColor) => setHeader({ textColor })} />
        </div>
        <Toggle label="Show search" checked={cfg.header.showSearch} onChange={(showSearch) => setHeader({ showSearch })} />
        <Toggle label="Show cart" checked={cfg.header.showCart} onChange={(showCart) => setHeader({ showCart })} />
        <Toggle label="Keep header visible while scrolling" checked={cfg.header.sticky} onChange={(sticky) => setHeader({ sticky })} />
      </Group>

      <div className="sb-heading">
        <h3>Menu</h3>
        <p>Each menu can open a dropdown. A dropdown link whose page is off is hidden automatically.</p>
      </div>
      {cfg.nav.map((item, i) => (
        <NavItemEditor
          key={item.id}
          item={item}
          index={i}
          count={cfg.nav.length}
          env={env}
          onChange={(next) => setNav(replaceAt(cfg.nav, i, next))}
          onMove={(dir) => setNav(moveItem(cfg.nav, i, dir))}
          onRemove={() => setNav(removeAt(cfg.nav, i))}
        />
      ))}
      {cfg.nav.length < IL_LIMITS.nav && (
        <button
          type="button"
          className="sb-add"
          onClick={() => setNav([...cfg.nav, { id: newId("menu", cfg.nav), show: true, label: "New menu", link: { ...NO_LINK, type: "page", page: "home" }, children: [] }])}
        >
          + Add menu
        </button>
      )}
    </>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  twitter: "X / Twitter",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  viber: "Viber",
};

function SocialList({ items, onChange }: { items: IlSocial[]; onChange: (s: IlSocial[]) => void }) {
  return (
    <div className="sb-list">
      {items.map((s, i) => (
        <div key={s.id} className="sb-row">
          <div className="sb-row__head">
            <select
              className="admin-select"
              aria-label="Platform"
              value={s.platform}
              onChange={(e) => onChange(replaceAt(items, i, { ...s, platform: e.target.value as IlSocial["platform"] }))}
            >
              {IL_SOCIAL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
            <input
              className="admin-input sb-row__title"
              aria-label="Profile link"
              placeholder="https://…"
              value={s.url}
              maxLength={500}
              onChange={(e) => onChange(replaceAt(items, i, { ...s, url: e.target.value }))}
            />
            <RowControls index={i} count={items.length} onMove={(d) => onChange(moveItem(items, i, d))} onRemove={() => onChange(removeAt(items, i))} name={PLATFORM_LABELS[s.platform]} />
          </div>
        </div>
      ))}
      {items.length < IL_LIMITS.socials && (
        <button type="button" className="sb-add" onClick={() => onChange([...items, { id: newId("social", items), platform: "facebook", url: "" }])}>
          + Add social link
        </button>
      )}
    </div>
  );
}

function InfoPages({ pages, onChange }: { pages: IlInfoPage[]; onChange: (p: IlInfoPage[]) => void }) {
  return (
    <div className="sb-list">
      {pages.map((p, i) => (
        <div key={p.id} className="sb-row">
          <div className="sb-row__head">
            <input
              className="admin-input sb-row__title"
              aria-label="Page title"
              value={p.title}
              maxLength={IL_LIMITS.short}
              onChange={(e) => onChange(replaceAt(pages, i, { ...p, title: e.target.value }))}
            />
            {!p.body.trim() && <span className="sb-badge sb-badge--warn">Hidden until written</span>}
            <RowControls index={i} count={pages.length} onMove={(d) => onChange(moveItem(pages, i, d))} onRemove={() => onChange(removeAt(pages, i))} name={p.title || "page"} />
          </div>
          <TextInput label="Page text" value={p.body} max={IL_LIMITS.body} multiline onChange={(body) => onChange(replaceAt(pages, i, { ...p, body }))} hint="Blank lines start a new paragraph." />
        </div>
      ))}
      {pages.length < IL_LIMITS.infoPages && (
        <button type="button" className="sb-add" onClick={() => onChange([...pages, { id: newId("page", pages), title: "New page", body: "" }])}>
          + Add info page
        </button>
      )}
    </div>
  );
}

export function FooterPanel({ cfg, update, env, brand }: PanelProps) {
  const f = cfg.footer;
  const setFooter = (patch: Partial<IntlLocalConfig["footer"]>) => update((c) => ({ ...c, footer: { ...c.footer, ...patch } }));
  const setFab = (patch: Partial<IntlLocalConfig["fab"]>) => update((c) => ({ ...c, fab: { ...c.fab, ...patch } }));
  return (
    <>
      <Group title="Footer" defaultOpen badge={f.show ? "On" : "Off"}>
        <Toggle label="Show the footer" checked={f.show} onChange={(show) => setFooter({ show })} />
        <TextInput label="Brand name" value={f.brandName} placeholder={brand.name} hint="Leave blank to use your store name." onChange={(brandName) => setFooter({ brandName })} />
        <TextInput label="Description" value={f.tagline} max={IL_LIMITS.long} onChange={(tagline) => setFooter({ tagline })} />
        <TextInput label="Copyright" value={f.copyright} max={IL_LIMITS.long} hint="{year} and {brand} are filled in for you." onChange={(copyright) => setFooter({ copyright })} />
        <ColorInput label="Text colour" value={f.textColor} onChange={(textColor) => setFooter({ textColor })} />
        <BackgroundEditor value={f.background} textColor={f.textColor} onChange={(background) => setFooter({ background })} />
      </Group>

      <Group title="Footer links" badge={String(f.links.length)}>
        <LinkList items={f.links} onChange={(links) => setFooter({ links })} env={env} max={IL_LIMITS.footerLinks} addLabel="Add footer link" idPrefix="footer" />
      </Group>

      <Group title="Info pages (About, Privacy, Terms…)">
        <p className="sb-sub">Footer and menu links can open these. A page with no text stays hidden.</p>
        <InfoPages pages={cfg.infoPages} onChange={(infoPages) => update((c) => ({ ...c, infoPages }))} />
      </Group>

      <Group title="Social links">
        <Toggle
          label="Use the social links already set for my store"
          checked={f.useStoreSocials}
          onChange={(useStoreSocials) => setFooter({ useStoreSocials })}
        />
        {!f.useStoreSocials && <SocialList items={f.socials} onChange={(socials) => setFooter({ socials })} />}
      </Group>

      <Group title="Floating contact button" badge={cfg.fab.show ? "On" : "Off"}>
        <Toggle label="Show the contact button" checked={cfg.fab.show} onChange={(show) => setFab({ show })} />
        <TextInput label="Label" value={cfg.fab.label} max={IL_LIMITS.label} hint="Phones show the icon only, so it never covers a buy button." onChange={(label) => setFab({ label })} />
        <IconPicker value={cfg.fab.icon} onChange={(icon) => setFab({ icon })} />
        <LinkEditor label="Opens" link={cfg.fab.link} onChange={(link) => setFab({ link })} env={env} />
        <div className="admin-form__row">
          <ColorInput label="Button colour" value={cfg.fab.color} onChange={(color) => setFab({ color })} emptyLabel="Accent" />
          <ColorInput label="Text colour" value={cfg.fab.textColor} onChange={(textColor) => setFab({ textColor })} emptyLabel="Accent text" />
        </div>
        <SelectInput
          label="Position"
          value={cfg.fab.position}
          options={[
            { value: "right", label: "Bottom right" },
            { value: "left", label: "Bottom left" },
          ]}
          onChange={(position) => setFab({ position })}
        />
        <Toggle label="Show on desktop" checked={cfg.fab.showDesktop} onChange={(showDesktop) => setFab({ showDesktop })} />
        <Toggle label="Show on phones" checked={cfg.fab.showMobile} onChange={(showMobile) => setFab({ showMobile })} />
      </Group>
    </>
  );
}
