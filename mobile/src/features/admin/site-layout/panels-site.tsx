// Website Layout — the SITE-WIDE panels: General (name, logo, colours, type,
// shape) and Header & menu (top bar, header style, the menu builder). Native
// twins of src/storefront/admin/site-builder/panels-site.tsx; each edits its
// slice of the draft through `update`, never mutating it.

import { StyleSheet, View } from "react-native";
import type { AdminBrand } from "@/features/admin/bridge";
import { str } from "@/features/admin/setup/rules";
import { SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { FONT_OPTIONS, IL_LIMITS, type IlNavChild, type IlNavItem, type IntlLocalConfig } from "./config";
import { BackgroundEditor } from "./BackgroundEditor";
import { ColorField, Group, ImageInput, LinkEditor, Range, RowControls, Select, SubBox, TextField, Toggle, type LayoutEnv } from "./fields";
import { NO_LINK } from "./links";
import { moveItem, newId, removeAt, replaceAt } from "./normalize";

export type PanelProps = {
  cfg: IntlLocalConfig;
  update: (fn: (c: IntlLocalConfig) => IntlLocalConfig) => void;
  env: LayoutEnv;
  brand: AdminBrand;
};

const FONT_CHOICES = [{ value: "", label: "My store's font" }, ...FONT_OPTIONS.map((f) => ({ value: f, label: f }))];

export function GeneralPanel({ cfg, update, brand }: PanelProps) {
  const t = cfg.theme;
  const setTheme = (patch: Partial<IntlLocalConfig["theme"]>) => update((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const setHeader = (patch: Partial<IntlLocalConfig["header"]>) => update((c) => ({ ...c, header: { ...c.header, ...patch } }));
  return (
    <>
      <Group title="Website name & logo" defaultOpen>
        <TextField
          label="Website name"
          value={cfg.header.brandName}
          placeholder={str(brand.name)}
          hint="Leave blank to use your store name."
          onChange={(brandName) => setHeader({ brandName })}
        />
        <Toggle label="Show logo" value={cfg.header.showLogo} onChange={(showLogo) => setHeader({ showLogo })} />
        <ImageInput label="Logo" value={cfg.header.logoUrl} hint="Leave empty to use your store logo. Wide logos keep their shape." onChange={(logoUrl) => setHeader({ logoUrl })} />
        {cfg.header.showLogo ? (
          <Range label="Logo size" value={cfg.header.logoHeight} min={24} max={96} step={4} suffix="px" onChange={(logoHeight) => setHeader({ logoHeight })} />
        ) : null}
      </Group>

      <Group title="Colours" defaultOpen>
        <Toggle
          label="Use my store's brand colours"
          hint="Off = the colours below. Each card and section can still have its own background."
          value={t.useBrandColors}
          onChange={(useBrandColors) => setTheme({ useBrandColors })}
        />
        {!t.useBrandColors ? (
          <>
            <ColorField label="Page background" value={t.pageBg} allowEmpty={false} onChange={(pageBg) => setTheme({ pageBg })} />
            <ColorField label="Surfaces (menus, inputs)" value={t.surface} allowEmpty={false} onChange={(surface) => setTheme({ surface })} />
            <ColorField label="Text" value={t.ink} allowEmpty={false} onChange={(ink) => setTheme({ ink })} />
            <ColorField label="Muted text" value={t.muted} allowEmpty={false} onChange={(muted) => setTheme({ muted })} />
            <ColorField label="Accent (buttons, links)" value={t.accent} allowEmpty={false} onChange={(accent) => setTheme({ accent })} />
            <ColorField label="Text on accent" value={t.accentText} allowEmpty={false} onChange={(accentText) => setTheme({ accentText })} />
          </>
        ) : null}
      </Group>

      <Group title="Typography">
        <Select label="Heading font" value={t.headingFont} options={FONT_CHOICES} onChange={(headingFont) => setTheme({ headingFont })} />
        <Select label="Body font" value={t.bodyFont} options={FONT_CHOICES} onChange={(bodyFont) => setTheme({ bodyFont })} />
        <Select
          label="Heading weight"
          value={String(t.headingWeight)}
          options={["500", "600", "700", "800", "900"].map((w) => ({ value: w, label: w }))}
          onChange={(w) => setTheme({ headingWeight: Number(w) })}
        />
        <Select
          label="Text size"
          value={t.scale}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Medium" },
            { value: "lg", label: "Large" },
          ]}
          onChange={(scale) => setTheme({ scale })}
        />
      </Group>

      <Group title="Shape & spacing">
        <Range label="Corner rounding" value={t.radius} min={0} max={40} step={2} suffix="px" onChange={(radius) => setTheme({ radius })} />
        <Select
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
  env: LayoutEnv;
  max: number;
  addLabel: string;
  idPrefix: string;
}) {
  return (
    <View style={{ gap: SPACE.md }}>
      {items.map((child, i) => (
        <SubBox key={child.id}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Toggle label={child.show ? "Shown" : "Hidden"} value={child.show} onChange={(show) => onChange(replaceAt(items, i, { ...child, show }))} />
            </View>
            <RowControls
              index={i}
              count={items.length}
              name={child.label || "link"}
              onMove={(d) => onChange(moveItem(items, i, d))}
              onRemove={() => onChange(removeAt(items, i))}
            />
          </View>
          <Field label="Link text" value={child.label} maxLength={IL_LIMITS.label} onChangeText={(label) => onChange(replaceAt(items, i, { ...child, label }))} />
          <LinkEditor link={child.link} onChange={(link) => onChange(replaceAt(items, i, { ...child, link }))} env={env} />
        </SubBox>
      ))}
      {items.length < max ? (
        <Button
          label={addLabel}
          icon="add"
          variant="secondary"
          onPress={() => onChange([...items, { id: newId(idPrefix, items), show: true, label: "New link", link: { ...NO_LINK, type: "page", page: "home" } }])}
        />
      ) : null}
    </View>
  );
}

function NavItemEditor({ item, index, count, env, onChange, onMove, onRemove }: {
  item: IlNavItem;
  index: number;
  count: number;
  env: LayoutEnv;
  onChange: (i: IlNavItem) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <Group title={item.label || "Menu"} badge={item.show ? `${item.children.length} links` : "Hidden"}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Toggle label="Show in menu" value={item.show} onChange={(show) => onChange({ ...item, show })} />
        </View>
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={item.label || "menu"} />
      </View>
      <TextField label="Menu title" value={item.label} max={IL_LIMITS.label} onChange={(label) => onChange({ ...item, label })} />
      {item.children.length === 0 ? <LinkEditor label="Menu title goes to" link={item.link} onChange={(link) => onChange({ ...item, link })} env={env} /> : null}
      <AppText variant="label" color="muted">
        {item.children.length === 0 ? "Dropdown links (none, the title is a plain link)" : "Dropdown links"}
      </AppText>
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
  const setNav = (fn: (nav: IlNavItem[]) => IlNavItem[]) => update((c) => ({ ...c, nav: fn(c.nav) }));
  return (
    <>
      <Group title="Top bar" badge={cfg.topBar.show ? "On" : "Off"}>
        <Toggle label="Show the top bar" value={cfg.topBar.show} onChange={(show) => setTop({ show })} />
        <TextField label="Message" value={cfg.topBar.text} max={IL_LIMITS.long} onChange={(text) => setTop({ text })} />
        <TextField
          label="Subscribe link text"
          value={cfg.topBar.subscribeLabel}
          max={IL_LIMITS.label}
          hint="Scrolls to the newsletter section. Leave blank to hide."
          onChange={(subscribeLabel) => setTop({ subscribeLabel })}
        />
        <Toggle label="Show social icons" value={cfg.topBar.showSocials} onChange={(showSocials) => setTop({ showSocials })} />
        <ColorField label="Text colour" value={cfg.topBar.textColor} onChange={(textColor) => setTop({ textColor })} />
        <BackgroundEditor value={cfg.topBar.background} textColor={cfg.topBar.textColor} onChange={(background) => setTop({ background })} />
      </Group>

      <Group title="Header style">
        <ColorField label="Header background" value={cfg.header.bgColor} onChange={(bgColor) => setHeader({ bgColor })} />
        <ColorField label="Header text" value={cfg.header.textColor} onChange={(textColor) => setHeader({ textColor })} />
        <Toggle label="Show search" value={cfg.header.showSearch} onChange={(showSearch) => setHeader({ showSearch })} />
        <Toggle label="Show cart" value={cfg.header.showCart} onChange={(showCart) => setHeader({ showCart })} />
        <Toggle label="Keep header visible while scrolling" value={cfg.header.sticky} onChange={(sticky) => setHeader({ sticky })} />
      </Group>

      <View style={{ gap: 4 }}>
        <AppText variant="heading" accessibilityRole="header">
          Menu
        </AppText>
        <AppText variant="caption" color="muted">
          Each menu can open a dropdown. A dropdown link whose page is off is hidden automatically.
        </AppText>
      </View>
      {cfg.nav.map((item, i) => (
        <NavItemEditor
          key={item.id}
          item={item}
          index={i}
          count={cfg.nav.length}
          env={env}
          onChange={(next) => setNav((nav) => replaceAt(nav, i, next))}
          onMove={(d) => setNav((nav) => moveItem(nav, i, d))}
          onRemove={() => setNav((nav) => removeAt(nav, i))}
        />
      ))}
      {cfg.nav.length < IL_LIMITS.nav ? (
        <Button
          label="Add menu"
          icon="add"
          variant="secondary"
          onPress={() => setNav((nav) => [...nav, { id: newId("menu", nav), show: true, label: "New menu", link: { ...NO_LINK, type: "page", page: "home" }, children: [] }])}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
