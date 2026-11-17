// The Website Layout editor's form controls — the native twins of the web's
// src/storefront/admin/site-builder/fields.tsx: collapsible groups, colour and
// range inputs, the icon picker, image upload, and the link / button editors
// (with the web's plain-language "this link is hidden" warning).

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { IconButton, SelectField } from "@/features/admin/catalog/components";
import { ImageField } from "@/features/admin/setup/ImageField";
import { heroMediaSrcIssue } from "@/features/admin/setup/rules";
import { Hint, Stepper, ToggleRow } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Card, type IconName } from "@/ui/primitives";
import { IL_BUTTON_STYLES, IL_ICONS, IL_LIMITS, IL_PALETTE, type IlButton, type IlIcon, type IlInfoPage } from "./config";
import { IL_LINK_PAGES, IL_LINK_SECTIONS, IL_LINK_TYPES, linkProblem, normalizeLink, type IlLink, type IlLinkContext, type IlLinkType } from "./links";
import { safeCssColor } from "./normalize";

/** What every panel needs from the store around it (web: LinkEnv + SiteBuilderEnv). */
export type LayoutEnv = {
  ctx: IlLinkContext;
  infoPages: IlInfoPage[];
  categories: { id: string; label: string }[];
};

// ── layout ──────────────────────────────────────────────────────────────────

/** A collapsible group (the web's <details className="sb-group">). */
export function Group({ title, badge, defaultOpen = false, children }: { title: string; badge?: string; defaultOpen?: boolean; children: ReactNode }) {
  const t = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={badge ? `${title}, ${badge}` : title}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.groupHead, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
      >
        <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </AppText>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: t.colors.surfaceAlt }]}>
            <AppText variant="caption" color="muted" numberOfLines={1}>
              {badge}
            </AppText>
          </View>
        ) : null}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.colors.textFaint} />
      </Pressable>
      {open ? <View style={[styles.groupBody, { borderColor: t.colors.border }]}>{children}</View> : null}
    </Card>
  );
}

/** A nested box inside a group (the web's <fieldset>). */
export function SubBox({ title, children }: { title?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.sub, { borderColor: t.colors.border }]}>
      {title ? (
        <AppText variant="label" color="link">
          {title}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

export function Warn({ children }: { children: string }) {
  return <Hint tone="warning">{children}</Hint>;
}

// ── inputs ──────────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  max = IL_LIMITS.short,
  multiline,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  multiline?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return <Field label={label} value={value} onChangeText={onChange} maxLength={max} multiline={multiline} hint={hint} placeholder={placeholder} />;
}

export function Select<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return <SelectField label={label} value={value} options={options} hint={hint} onChange={(v) => onChange(v as T)} />;
}

export function Range({ label, value, onChange, min = 0, max = 100, step = 5, suffix = "%" }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return <Stepper label={label} value={value} display={`${value}${suffix}`} min={min} max={max} step={step} onChange={onChange} />;
}

export { ToggleRow as Toggle };

const SWATCHES = ["#FFFFFF", "#000000", IL_PALETTE.cream, IL_PALETTE.lavender, IL_PALETTE.lavenderDeep, IL_PALETTE.pink, IL_PALETTE.yellow, IL_PALETTE.butter, IL_PALETTE.ink, IL_PALETTE.accent];

/** A colour: hex/rgb text + live swatch + quick picks. `allowEmpty` adds a clear chip. */
export function ColorField({ label, value, onChange, allowEmpty = true, emptyLabel = "Default" }: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean; emptyLabel?: string }) {
  const t = useTheme();
  const valid = safeCssColor(value);
  const bad = !!value.trim() && !valid;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.colorRow}>
        <View style={[styles.swatchBig, { backgroundColor: valid || "transparent", borderColor: t.colors.border }]} accessibilityElementsHidden />
        <View style={{ flex: 1 }}>
          <Field
            label={label}
            value={value}
            onChangeText={(v) => onChange(v.trim())}
            maxLength={64}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={allowEmpty ? emptyLabel : "#RRGGBB"}
            error={bad ? "Not a colour. Use #RRGGBB (it won't be saved)." : null}
          />
        </View>
      </View>
      <View style={styles.swatches}>
        {allowEmpty ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${emptyLabel}`} onPress={() => onChange("")} style={[styles.chip, { borderColor: !value ? t.colors.text : t.colors.border }]}>
            <AppText variant="caption">{emptyLabel}</AppText>
          </Pressable>
        ) : null}
        {SWATCHES.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${c}`}
            onPress={() => onChange(c)}
            style={[styles.swatch, { backgroundColor: c, borderColor: value.toUpperCase() === c ? t.colors.text : t.colors.border, borderWidth: value.toUpperCase() === c ? 2 : 1 }]}
          />
        ))}
      </View>
    </View>
  );
}

/** Image upload into the store's ImageKit folder (web: ImageInput, kind "branding"). */
export function ImageInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <ImageField
      label={label}
      hint={hint}
      value={value}
      kind="branding"
      previewAspect={16 / 9}
      onChange={(url) => onChange(url)}
      validate={(url) => {
        const issue = heroMediaSrcIssue(url);
        return issue === "too-large" ? "That image is too large to store. Try a smaller file." : issue ? "That file type isn't supported." : null;
      }}
    />
  );
}

const ICON_GLYPHS: Record<IlIcon, IconName> = {
  none: "remove-outline",
  truck: "car-outline",
  globe: "globe-outline",
  plane: "airplane-outline",
  book: "book-outline",
  file: "document-text-outline",
  tools: "construct-outline",
  flask: "flask-outline",
  users: "people-outline",
  chat: "chatbubble-ellipses-outline",
  mail: "mail-outline",
  phone: "call-outline",
  heart: "heart-outline",
  star: "star-outline",
  shield: "shield-checkmark-outline",
  sparkle: "sparkles-outline",
  cart: "cart-outline",
  pin: "location-outline",
  leaf: "leaf-outline",
  gift: "gift-outline",
};

export function IconPicker({ label = "Icon", value, onChange }: { label?: string; value: IlIcon; onChange: (v: IlIcon) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.icons}>
        {IL_ICONS.map((name) => {
          const active = value === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={name === "none" ? "No icon" : name}
              onPress={() => onChange(name)}
              style={[styles.iconBtn, { borderColor: active ? t.colors.text : t.colors.border, backgroundColor: active ? t.colors.surfaceAlt : "transparent" }]}
            >
              <Ionicons name={ICON_GLYPHS[name]} size={20} color={t.colors.text} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── links + buttons ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<IlLinkType, string> = {
  page: "A page on my store",
  catalog: "My shop (optionally one category)",
  market: "A market's shop (Local or International)",
  section: "A section of my home page",
  url: "A custom link (website, email, phone)",
  contact: "My contact channel",
  info: "An info page (About, Terms…)",
  none: "No link (hide)",
};

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  catalog: "Shop / Catalog",
  reviews: "Reviews",
  faq: "FAQ",
  coa: "Lab results (COA)",
  protocols: "Protocols",
  calculator: "Calculator",
  track: "Track order",
  merchant: "Wholesale",
  articles: "Articles",
  assessment: "Assessment quiz",
  account: "Account (login / sign up)",
  groupbuy: "Group buy",
  "my-groupbuy": "My group buy order",
};

const SECTION_LABELS: Record<string, string> = { markets: "Shop your market", learn: "Learn & explore", community: "Community", newsletter: "Newsletter sign-up" };

export function LinkEditor({ label = "Goes to", link, onChange, env }: { label?: string; link: IlLink; onChange: (l: IlLink) => void; env: LayoutEnv }) {
  const set = (patch: Partial<IlLink>) => onChange(normalizeLink({ ...link, ...patch }));
  const problem = linkProblem(link, env.ctx);
  return (
    <View style={{ gap: SPACE.md }}>
      <Select label={label} value={link.type} options={IL_LINK_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))} onChange={(type) => set({ type })} />
      {link.type === "page" ? (
        <Select
          label="Page"
          value={link.page || "home"}
          options={IL_LINK_PAGES.map((p) => ({ value: p, label: `${PAGE_LABELS[p] ?? p}${env.ctx.isPageVisible(p) ? "" : " (off)"}` }))}
          onChange={(page) => set({ page })}
        />
      ) : null}
      {link.type === "catalog" ? (
        <Select label="Category" value={link.category} options={[{ value: "", label: "All products" }, ...env.categories.map((c) => ({ value: c.id, label: c.label }))]} onChange={(category) => set({ category })} />
      ) : null}
      {link.type === "market" ? (
        <Select
          label="Market"
          value={link.market === "international" ? "international" : "local"}
          options={[
            { value: "local", label: "Local shop" },
            { value: "international", label: "International shop (USD)" },
          ]}
          onChange={(market) => set({ market })}
        />
      ) : null}
      {link.type === "section" ? (
        <Select label="Section" value={link.section || "markets"} options={IL_LINK_SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] }))} onChange={(section) => set({ section })} />
      ) : null}
      {link.type === "url" ? (
        <Field
          label="Address"
          value={link.url}
          maxLength={500}
          placeholder="https://… · mailto:… · tel:…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={(url) => onChange({ ...link, url })}
        />
      ) : null}
      {link.type === "info" ? (
        <Select label="Info page" value={link.infoId} options={[{ value: "", label: "Choose…" }, ...env.infoPages.map((p) => ({ value: p.id, label: p.title || p.id }))]} onChange={(infoId) => set({ infoId })} />
      ) : null}
      {problem ? <Warn>{problem}</Warn> : null}
    </View>
  );
}

const STYLE_LABELS: Record<string, string> = { solid: "Solid", outline: "Outline", soft: "Soft" };

export function ButtonEditor({ title, btn, onChange, env }: { title: string; btn: IlButton; onChange: (b: IlButton) => void; env: LayoutEnv }) {
  const set = (patch: Partial<IlButton>) => onChange({ ...btn, ...patch });
  return (
    <SubBox title={title}>
      <ToggleRow label="Show this button" value={btn.show} onChange={(show) => set({ show })} />
      <TextField label="Label" value={btn.label} max={IL_LIMITS.label} onChange={(label) => set({ label })} />
      <Select label="Style" value={btn.style} options={IL_BUTTON_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] }))} onChange={(style) => set({ style })} />
      <LinkEditor link={btn.link} onChange={(link) => set({ link })} env={env} />
      <ColorField label="Button colour" value={btn.color} onChange={(color) => set({ color })} emptyLabel="Theme" />
      <ColorField label="Button text" value={btn.textColor} onChange={(textColor) => set({ textColor })} emptyLabel="Theme" />
    </SubBox>
  );
}

/** ↑ ↓ ✕ for one row of a list. */
export function RowControls({ index, count, onMove, onRemove, name }: { index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove?: () => void; name: string }) {
  return (
    <View style={styles.rowCtl}>
      <IconButton icon="arrow-up" label={`Move ${name} up`} disabled={index === 0} onPress={() => onMove(-1)} />
      <IconButton icon="arrow-down" label={`Move ${name} down`} disabled={index === count - 1} onPress={() => onMove(1)} />
      {onRemove ? <IconButton icon="trash-outline" tone="danger" label={`Remove ${name}`} onPress={onRemove} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  groupHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.lg, minHeight: 52 },
  groupBody: { gap: SPACE.lg, padding: SPACE.lg, borderTopWidth: StyleSheet.hairlineWidth },
  badge: { borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3, maxWidth: 140 },
  sub: { gap: SPACE.md, padding: SPACE.md, borderWidth: 1, borderRadius: RADIUS.md },
  colorRow: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm },
  swatchBig: { width: 48, height: 48, borderRadius: RADIUS.md, borderWidth: 1, marginBottom: 2 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  chip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, height: 30, justifyContent: "center" },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowCtl: { flexDirection: "row", alignItems: "center" },
});
