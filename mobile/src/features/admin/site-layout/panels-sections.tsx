// Website Layout — the Sections panel: section order, Learn & explore cards,
// the Community band, the Newsletter (+ its subscriber list) and custom
// sections. Native twin of SectionsPanel in
// src/storefront/admin/site-builder/panels-home.tsx.

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SPACE } from "@/theme/tokens";
import { AppText, Button } from "@/ui/primitives";
import { IL_LIMITS, colorBackground, type IlBand, type IlCard, type IntlLocalConfig } from "./config";
import { BackgroundEditor, CardColorInput } from "./BackgroundEditor";
import { ButtonEditor, ColorField, Group, IconPicker, ImageInput, LinkEditor, RowControls, TextField, Toggle, type LayoutEnv } from "./fields";
import { newCustomSection } from "./defaults";
import { NO_LINK } from "./links";
import { moveItem, newId, removeAt, replaceAt } from "./normalize";
import type { PanelProps } from "./panels-site";
import { Subscribers } from "./Subscribers";

function HeadRow({ children, controls }: { children: ReactNode; controls: ReactNode }) {
  return (
    <View style={styles.head}>
      <View style={{ flex: 1 }}>{children}</View>
      {controls}
    </View>
  );
}

function LearnCardEditor({ card, index, count, onChange, onMove, onRemove, env }: {
  card: IlCard;
  index: number;
  count: number;
  onChange: (c: IlCard) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  env: LayoutEnv;
}) {
  const set = (patch: Partial<IlCard>) => onChange({ ...card, ...patch });
  return (
    <Group title={card.title || "Card"} badge={card.show ? "Shown" : "Hidden"}>
      <HeadRow controls={<RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={card.title || "card"} />}>
        <Toggle label="Show this card" value={card.show} onChange={(show) => set({ show })} />
      </HeadRow>
      <TextField label="Title" value={card.title} onChange={(title) => set({ title })} />
      <TextField label="Description" value={card.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      <CardColorInput value={card.background} onChange={(background) => set({ background })} />
      <IconPicker value={card.icon} onChange={(icon) => set({ icon })} />
      <ImageInput label="Image instead of icon (optional)" value={card.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
      <ColorField label="Icon circle colour" value={card.iconBg} onChange={(iconBg) => set({ iconBg })} />
      <TextField label="Link text" value={card.ctaLabel} max={IL_LIMITS.label} hint="Leave blank for a card with no link." onChange={(ctaLabel) => set({ ctaLabel })} />
      {card.ctaLabel ? <LinkEditor link={card.link} onChange={(link) => set({ link })} env={env} /> : null}
      <ColorField label="Text colour" value={card.textColor} onChange={(textColor) => set({ textColor })} />
      <BackgroundEditor title="Card background" value={card.background} textColor={card.textColor} onChange={(background) => set({ background })} />
    </Group>
  );
}

function BandEditor({ band, onChange, env }: { band: IlBand; onChange: (b: IlBand) => void; env: LayoutEnv }) {
  const set = (patch: Partial<IlBand>) => onChange({ ...band, ...patch });
  return (
    <>
      <Toggle label="Show this section" value={band.show} onChange={(show) => set({ show })} />
      <TextField label="Title" value={band.title} onChange={(title) => set({ title })} />
      <TextField label="Description" value={band.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      <CardColorInput label="Section colour" value={band.background} onChange={(background) => set({ background })} />
      <IconPicker value={band.icon} onChange={(icon) => set({ icon })} />
      <ImageInput label="Image instead of icon (optional)" value={band.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
      <ButtonEditor title="Button" btn={band.button} env={env} onChange={(button) => set({ button })} />
      <ColorField label="Text colour" value={band.textColor} onChange={(textColor) => set({ textColor })} />
      <BackgroundEditor value={band.background} textColor={band.textColor} onChange={(background) => set({ background })} />
    </>
  );
}

const SECTION_NAMES: Record<string, string> = {
  hero: "Hero",
  markets: "Shop your market",
  learn: "Learn & explore",
  community: "Community & reviews",
  newsletter: "Newsletter",
};

const blankLearnCard = (id: string): IlCard => ({
  id,
  show: true,
  title: "New card",
  description: "",
  icon: "sparkle",
  imageUrl: "",
  ctaLabel: "",
  link: { ...NO_LINK },
  iconBg: "",
  background: colorBackground("#ECE6FB"),
  textColor: "",
});

export function SectionsPanel({ cfg, update, env }: PanelProps) {
  const setLearn = (patch: Partial<IntlLocalConfig["learn"]>) => update((c) => ({ ...c, learn: { ...c.learn, ...patch } }));
  const setCards = (fn: (cards: IlCard[]) => IlCard[]) => update((c) => ({ ...c, learn: { ...c.learn, cards: fn(c.learn.cards) } }));
  const setNews = (patch: Partial<IntlLocalConfig["newsletter"]>) => update((c) => ({ ...c, newsletter: { ...c.newsletter, ...patch } }));
  const sectionName = (key: string) => SECTION_NAMES[key] ?? cfg.customSections.find((s) => `custom:${s.id}` === key)?.title ?? "Custom section";
  const n = cfg.newsletter;

  return (
    <>
      <Group title="Section order" defaultOpen>
        {cfg.order.map((key, i) => (
          <HeadRow
            key={key}
            controls={<RowControls index={i} count={cfg.order.length} name={sectionName(key)} onMove={(d) => update((c) => ({ ...c, order: moveItem(c.order, i, d) }))} />}
          >
            <AppText variant="body">{`${i + 1}. ${sectionName(key)}`}</AppText>
          </HeadRow>
        ))}
      </Group>

      <Group title="Learn & explore" badge={cfg.learn.show ? `${cfg.learn.cards.length} cards` : "Off"}>
        <Toggle label="Show this section" value={cfg.learn.show} onChange={(show) => setLearn({ show })} />
        <TextField label="Title" value={cfg.learn.title} onChange={(title) => setLearn({ title })} />
        <TextField label="Description" value={cfg.learn.description} max={IL_LIMITS.long} onChange={(description) => setLearn({ description })} />
        {cfg.learn.cards.map((card, i) => (
          <LearnCardEditor
            key={card.id}
            card={card}
            index={i}
            count={cfg.learn.cards.length}
            env={env}
            onChange={(next) => setCards((cards) => replaceAt(cards, i, next))}
            onMove={(d) => setCards((cards) => moveItem(cards, i, d))}
            onRemove={() => setCards((cards) => removeAt(cards, i))}
          />
        ))}
        {cfg.learn.cards.length < IL_LIMITS.cards ? (
          <Button label="Add card" icon="add" variant="secondary" onPress={() => setCards((cards) => [...cards, blankLearnCard(newId("card", cards))])} />
        ) : null}
      </Group>

      <Group title="Community & reviews" badge={cfg.community.show ? "On" : "Off"}>
        <BandEditor band={cfg.community} env={env} onChange={(community) => update((c) => ({ ...c, community }))} />
      </Group>

      <Group title="Newsletter" badge={n.show ? "On" : "Off"}>
        <Toggle label="Show the sign-up form" value={n.show} onChange={(show) => setNews({ show })} />
        <TextField label="Heading" value={n.title} onChange={(title) => setNews({ title })} />
        <TextField label="Description" value={n.description} max={IL_LIMITS.long} onChange={(description) => setNews({ description })} />
        <TextField label="Email placeholder" value={n.placeholder} max={IL_LIMITS.label} onChange={(placeholder) => setNews({ placeholder })} />
        <TextField label="Button text" value={n.buttonLabel} max={IL_LIMITS.label} onChange={(buttonLabel) => setNews({ buttonLabel })} />
        <TextField label="Thank-you message" value={n.successMessage} max={IL_LIMITS.long} onChange={(successMessage) => setNews({ successMessage })} />
        <IconPicker value={n.icon} onChange={(icon) => setNews({ icon })} />
        <ColorField label="Text colour" value={n.textColor} onChange={(textColor) => setNews({ textColor })} />
        <BackgroundEditor value={n.background} textColor={n.textColor} onChange={(background) => setNews({ background })} />
        <AppText variant="caption" color="muted">
          {"Sign-ups are saved to your store's contacts. Export them any time:"}
        </AppText>
        <Subscribers />
      </Group>

      <View style={{ gap: 4 }}>
        <AppText variant="heading" accessibilityRole="header">
          Custom sections
        </AppText>
        <AppText variant="caption" color="muted">
          Extra full-width bands: an announcement, a promo, a story. Reorder them above.
        </AppText>
      </View>
      {cfg.customSections.map((band, i) => (
        <Group key={band.id} title={band.title || "Custom section"} badge={band.show ? "On" : "Off"}>
          <HeadRow
            controls={
              <RowControls
                index={i}
                count={cfg.customSections.length}
                name={band.title || "section"}
                onMove={(d) => update((c) => ({ ...c, customSections: moveItem(c.customSections, i, d) }))}
                onRemove={() =>
                  update((c) => ({ ...c, customSections: removeAt(c.customSections, i), order: c.order.filter((k) => k !== `custom:${band.id}`) }))
                }
              />
            }
          >
            <AppText variant="caption" color="muted">{`Section ${i + 1}`}</AppText>
          </HeadRow>
          <BandEditor band={band} env={env} onChange={(next) => update((c) => ({ ...c, customSections: replaceAt(c.customSections, i, next) }))} />
        </Group>
      ))}
      {cfg.customSections.length < IL_LIMITS.customSections ? (
        <Button
          label="Add custom section"
          icon="add"
          variant="secondary"
          onPress={() =>
            update((c) => {
              const id = newId("section", c.customSections);
              return { ...c, customSections: [...c.customSections, newCustomSection(id)], order: [...c.order, `custom:${id}`] };
            })
          }
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
