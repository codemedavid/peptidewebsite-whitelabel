// Website Layout — the Footer panel: footer copy, footer links, info pages,
// social links and the floating contact button. Native twin of FooterPanel in
// src/storefront/admin/site-builder/panels-site.tsx.

import { StyleSheet, View } from "react-native";
import { str } from "@/features/admin/setup/rules";
import { SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";
import { IL_LIMITS, IL_SOCIAL_PLATFORMS, type IlInfoPage, type IlSocial, type IntlLocalConfig } from "./config";
import { BackgroundEditor } from "./BackgroundEditor";
import { ColorField, Group, IconPicker, LinkEditor, RowControls, Select, SubBox, TextField, Toggle } from "./fields";
import { moveItem, newId, removeAt, replaceAt } from "./normalize";
import { LinkList, type PanelProps } from "./panels-site";

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
    <View style={{ gap: SPACE.md }}>
      {items.map((s, i) => (
        <SubBox key={s.id}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Select
                label="Platform"
                value={s.platform}
                options={IL_SOCIAL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
                onChange={(platform) => onChange(replaceAt(items, i, { ...s, platform }))}
              />
            </View>
            <RowControls index={i} count={items.length} name={PLATFORM_LABELS[s.platform]} onMove={(d) => onChange(moveItem(items, i, d))} onRemove={() => onChange(removeAt(items, i))} />
          </View>
          <Field
            label="Profile link"
            value={s.url}
            maxLength={500}
            placeholder="https://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={(url) => onChange(replaceAt(items, i, { ...s, url }))}
          />
        </SubBox>
      ))}
      {items.length < IL_LIMITS.socials ? (
        <Button label="Add social link" icon="add" variant="secondary" onPress={() => onChange([...items, { id: newId("social", items), platform: "facebook", url: "" }])} />
      ) : null}
    </View>
  );
}

function InfoPages({ pages, onChange }: { pages: IlInfoPage[]; onChange: (p: IlInfoPage[]) => void }) {
  return (
    <View style={{ gap: SPACE.md }}>
      {pages.map((p, i) => (
        <SubBox key={p.id}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>{!p.body.trim() ? <Pill tone="warning" icon="eye-off-outline" label="Hidden until written" size="sm" /> : null}</View>
            <RowControls index={i} count={pages.length} name={p.title || "page"} onMove={(d) => onChange(moveItem(pages, i, d))} onRemove={() => onChange(removeAt(pages, i))} />
          </View>
          <Field label="Page title" value={p.title} maxLength={IL_LIMITS.short} onChangeText={(title) => onChange(replaceAt(pages, i, { ...p, title }))} />
          <TextField label="Page text" value={p.body} max={IL_LIMITS.body} multiline hint="Blank lines start a new paragraph." onChange={(body) => onChange(replaceAt(pages, i, { ...p, body }))} />
        </SubBox>
      ))}
      {pages.length < IL_LIMITS.infoPages ? (
        <Button label="Add info page" icon="add" variant="secondary" onPress={() => onChange([...pages, { id: newId("page", pages), title: "New page", body: "" }])} />
      ) : null}
    </View>
  );
}

export function FooterPanel({ cfg, update, env, brand }: PanelProps) {
  const f = cfg.footer;
  const setFooter = (patch: Partial<IntlLocalConfig["footer"]>) => update((c) => ({ ...c, footer: { ...c.footer, ...patch } }));
  const setFab = (patch: Partial<IntlLocalConfig["fab"]>) => update((c) => ({ ...c, fab: { ...c.fab, ...patch } }));
  return (
    <>
      <Group title="Footer" defaultOpen badge={f.show ? "On" : "Off"}>
        <Toggle label="Show the footer" value={f.show} onChange={(show) => setFooter({ show })} />
        <TextField label="Brand name" value={f.brandName} placeholder={str(brand.name)} hint="Leave blank to use your store name." onChange={(brandName) => setFooter({ brandName })} />
        <TextField label="Description" value={f.tagline} max={IL_LIMITS.long} onChange={(tagline) => setFooter({ tagline })} />
        <TextField label="Copyright" value={f.copyright} max={IL_LIMITS.long} hint="{year} and {brand} are filled in for you." onChange={(copyright) => setFooter({ copyright })} />
        <ColorField label="Text colour" value={f.textColor} onChange={(textColor) => setFooter({ textColor })} />
        <BackgroundEditor value={f.background} textColor={f.textColor} onChange={(background) => setFooter({ background })} />
      </Group>

      <Group title="Footer links" badge={String(f.links.length)}>
        <LinkList items={f.links} onChange={(links) => setFooter({ links })} env={env} max={IL_LIMITS.footerLinks} addLabel="Add footer link" idPrefix="footer" />
      </Group>

      <Group title="Info pages (About, Privacy, Terms…)">
        <AppText variant="caption" color="muted">
          Footer and menu links can open these. A page with no text stays hidden.
        </AppText>
        <InfoPages pages={cfg.infoPages} onChange={(infoPages) => update((c) => ({ ...c, infoPages }))} />
      </Group>

      <Group title="Social links">
        <Toggle label="Use the social links already set for my store" value={f.useStoreSocials} onChange={(useStoreSocials) => setFooter({ useStoreSocials })} />
        {!f.useStoreSocials ? <SocialList items={f.socials} onChange={(socials) => setFooter({ socials })} /> : null}
      </Group>

      <Group title="Floating contact button" badge={cfg.fab.show ? "On" : "Off"}>
        <Toggle label="Show the contact button" value={cfg.fab.show} onChange={(show) => setFab({ show })} />
        <TextField label="Label" value={cfg.fab.label} max={IL_LIMITS.label} hint="Phones show the icon only, so it never covers a buy button." onChange={(label) => setFab({ label })} />
        <IconPicker value={cfg.fab.icon} onChange={(icon) => setFab({ icon })} />
        <LinkEditor label="Opens" link={cfg.fab.link} onChange={(link) => setFab({ link })} env={env} />
        <ColorField label="Button colour" value={cfg.fab.color} onChange={(color) => setFab({ color })} emptyLabel="Accent" />
        <ColorField label="Text colour" value={cfg.fab.textColor} onChange={(textColor) => setFab({ textColor })} emptyLabel="Accent text" />
        <Select
          label="Position"
          value={cfg.fab.position}
          options={[
            { value: "right", label: "Bottom right" },
            { value: "left", label: "Bottom left" },
          ]}
          onChange={(position) => setFab({ position })}
        />
        <Toggle label="Show on desktop" value={cfg.fab.showDesktop} onChange={(showDesktop) => setFab({ showDesktop })} />
        <Toggle label="Show on phones" value={cfg.fab.showMobile} onChange={(showMobile) => setFab({ showMobile })} />
      </Group>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
