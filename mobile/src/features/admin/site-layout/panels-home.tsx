// Website Layout — the Hero and Markets panels (incl. the International USD
// switch). Native twins of HeroPanel / MarketsPanel / IntlSellingSwitch in
// src/storefront/admin/site-builder/panels-home.tsx.

import { View } from "react-native";
import { normalizeCurrency, formatMoney } from "@/features/admin/catalog/currency";
import { Notice } from "@/features/admin/catalog/components";
import { SPACE } from "@/theme/tokens";
import { AppText, Button } from "@/ui/primitives";
import { IL_LIMITS, colorBackground, type IlArtBlend, type IlMarketCard, type IntlLocalConfig } from "./config";
import { BackgroundEditor, CardColorInput } from "./BackgroundEditor";
import { ButtonEditor, ColorField, Group, IconPicker, ImageInput, Range, RowControls, Select, TextField, Toggle, Warn, type LayoutEnv } from "./fields";
import { NO_LINK } from "./links";
import { moveItem, newId, removeAt, replaceAt } from "./normalize";
import type { PanelProps } from "./panels-site";

export function HeroPanel({ cfg, update, env }: PanelProps) {
  const h = cfg.hero;
  const set = (patch: Partial<IntlLocalConfig["hero"]>) => update((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  return (
    <>
      <Group title="Hero text" defaultOpen badge={h.show ? "On" : "Off"}>
        <Toggle label="Show the hero" value={h.show} onChange={(show) => set({ show })} />
        <TextField label="Eyebrow / tagline" value={h.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
        <TextField label="Title" value={h.title} max={IL_LIMITS.short * 2} onChange={(title) => set({ title })} />
        <TextField label="Description" value={h.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
        <Select
          label="Text alignment"
          value={h.align}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Centered" },
          ]}
          onChange={(align) => set({ align })}
        />
        <ColorField label="Text colour" value={h.textColor} onChange={(textColor) => set({ textColor })} />
      </Group>

      <Group title="Hero image">
        <ImageInput label="Desktop image" value={h.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
        <ImageInput label="Phone image (optional)" value={h.mobileImageUrl} hint="Shown on small screens instead of the desktop image." onChange={(mobileImageUrl) => set({ mobileImageUrl })} />
        <TextField label="Image description (for screen readers)" value={h.imageAlt} max={IL_LIMITS.long} onChange={(imageAlt) => set({ imageAlt })} />
        <Select
          label="Image position"
          value={h.imageSide}
          options={[
            { value: "right", label: "Right of the text" },
            { value: "left", label: "Left of the text" },
            { value: "none", label: "Don't show the image" },
          ]}
          onChange={(imageSide) => set({ imageSide })}
        />
      </Group>

      {h.buttons.map((b, i) => (
        <Group key={i} title={`Button ${i + 1}`} badge={b.show && b.label ? b.label : "Hidden"}>
          <ButtonEditor
            title={`Button ${i + 1}`}
            btn={b}
            env={env}
            onChange={(btn) => update((c) => ({ ...c, hero: { ...c.hero, buttons: replaceAt(c.hero.buttons, i, btn) } }))}
          />
        </Group>
      ))}

      <BackgroundEditor title="Hero background" value={h.background} textColor={h.textColor} onChange={(background) => set({ background })} />
    </>
  );
}

/** Switching to a watermark / full-card image starts it soft (web: MarketEditor). */
function opacityForBlend(card: IlMarketCard, next: IlArtBlend): number {
  if (next === card.imageBlend) return card.imageOpacity;
  if (next === "watermark") return 18;
  if (next === "cover") return 35;
  return card.imageBlend === "cover" || card.imageBlend === "watermark" ? 90 : card.imageOpacity;
}

function MarketEditor({ card, index, count, onChange, onMove, onRemove, env, storeCurrency }: {
  card: IlMarketCard;
  index: number;
  count: number;
  onChange: (c: IlMarketCard) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  env: LayoutEnv;
  storeCurrency: { code: string; symbol: string };
}) {
  const set = (patch: Partial<IlMarketCard>) => onChange({ ...card, ...patch });
  const linksInternally = card.button.link.type === "catalog" || (card.button.link.type === "page" && card.button.link.page === "catalog");
  const mismatch = linksInternally && !!card.currency.trim() && card.currency.trim().toUpperCase() !== storeCurrency.code.toUpperCase();
  return (
    <Group title={`${card.title || "Market"}${card.currency ? ` · ${card.currency}` : ""}`} badge={card.show ? "Shown" : "Hidden"}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
        <View style={{ flex: 1 }}>
          <Toggle label="Show this card" value={card.show} onChange={(show) => set({ show })} />
        </View>
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={card.title || "market"} />
      </View>
      <TextField label="Market label" value={card.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
      <TextField label="Title" value={card.title} onChange={(title) => set({ title })} />
      <TextField label="Currency label" value={card.currency} max={12} onChange={(currency) => set({ currency })} />
      <TextField label="Description" value={card.description} max={IL_LIMITS.long} onChange={(description) => set({ description })} />
      <CardColorInput value={card.background} onChange={(background) => set({ background })} />
      <ColorField label="Text colour" value={card.textColor} onChange={(textColor) => set({ textColor })} />
      {mismatch ? (
        <Warn>
          {`This card opens this store's catalog, which prices in ${storeCurrency.code} (${formatMoney(1000, storeCurrency.symbol)}), not ${card.currency}. Point the button at your ${card.currency} store with a custom link, or change the label.`}
        </Warn>
      ) : null}
      <IconPicker value={card.icon} onChange={(icon) => set({ icon })} />
      <ImageInput
        label="Card image (photo, flag, map…)"
        value={card.imageUrl}
        // A first upload fills the whole card, soft; a replacement keeps the owner's choice.
        onChange={(imageUrl) => set(card.imageUrl || !imageUrl ? { imageUrl } : { imageUrl, imageBlend: "cover", imageOpacity: 35 })}
      />
      {card.imageUrl ? (
        <>
          <Select
            label="How it sits on the card"
            value={card.imageBlend}
            options={[
              { value: "blend", label: "Blend into the card (hides white backgrounds)" },
              { value: "cover", label: "Fill the card (a background under the text)" },
              { value: "watermark", label: "Watermark (large and faint, behind the text)" },
              { value: "normal", label: "Show as uploaded" },
            ]}
            onChange={(imageBlend) => set({ imageBlend, imageOpacity: opacityForBlend(card, imageBlend) })}
          />
          {card.imageBlend === "cover" ? (
            <Select
              label="Image focus"
              value={card.imageFocus}
              options={[
                { value: "center", label: "Center" },
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
              onChange={(imageFocus) => set({ imageFocus })}
            />
          ) : (
            <Select
              label="Image size"
              value={card.imageSize}
              options={[
                { value: "sm", label: "Small" },
                { value: "md", label: "Medium" },
                { value: "lg", label: "Large" },
              ]}
              onChange={(imageSize) => set({ imageSize })}
            />
          )}
          <Range label="Image opacity" value={card.imageOpacity} onChange={(imageOpacity) => set({ imageOpacity })} />
          {card.imageBlend === "cover" ? (
            <AppText variant="caption" color="faint">
              Lower keeps your text the highlight. 25–45% works for most photos.
            </AppText>
          ) : null}
        </>
      ) : null}
      <ButtonEditor title="Button" btn={card.button} env={env} onChange={(button) => set({ button })} />
      <BackgroundEditor title="More background options" value={card.background} textColor={card.textColor} onChange={(background) => set({ background })} />
    </Group>
  );
}

/** The International switch — saves the moment it's flipped (it changes checkout). */
export type IntlSwitch = { enabled: boolean; busy: boolean; setEnabled: (enabled: boolean) => void };

function IntlSellingSwitch({ intl, homeLayout }: { intl: IntlSwitch; homeLayout: string }) {
  return (
    <Group title="International shop (USD)" defaultOpen badge={intl.enabled ? "On" : "Off"}>
      <Toggle
        label="Sell internationally in USD"
        hint="Saves right away. Adds a separate International shop and cart that charge in USD."
        value={intl.enabled}
        disabled={intl.busy}
        onChange={(v) => intl.setEnabled(v)}
      />
      {intl.enabled ? (
        <View style={{ gap: 6 }}>
          <AppText variant="caption">1. Products: set each product to Local, International or Both and give it a USD price (Manage Products → Markets).</AppText>
          <AppText variant="caption">2. Payments: tick which methods the International cart offers (Payments).</AppText>
          <AppText variant="caption">3. Shipping: add your International rates in USD (Shipping → International rates).</AppText>
          <AppText variant="caption">4. Fees & promos: optional USD amounts (Checkout Fee, Promo Codes).</AppText>
        </View>
      ) : null}
      {intl.enabled && homeLayout !== "intl-local" ? <Warn>The International shop opens once this store uses the Intl & Local layout.</Warn> : null}
    </Group>
  );
}

export function MarketsPanel({ cfg, update, env, brand, intl }: PanelProps & { intl: IntlSwitch }) {
  const m = cfg.markets;
  const setCards = (fn: (cards: IlMarketCard[]) => IlMarketCard[]) => update((c) => ({ ...c, markets: { ...c.markets, cards: fn(c.markets.cards) } }));
  const set = (patch: Partial<IntlLocalConfig["markets"]>) => update((c) => ({ ...c, markets: { ...c.markets, ...patch } }));
  const currency = normalizeCurrency(brand.currency);
  const homeLayout = typeof brand.homeLayout === "string" ? brand.homeLayout : "classic";
  const addCard = () =>
    setCards((cards) => [
      ...cards,
      {
        id: newId("market", cards),
        show: true,
        eyebrow: "",
        title: "New market",
        currency: currency.code,
        description: "",
        icon: "globe",
        imageUrl: "",
        imageBlend: "blend",
        imageSize: "md",
        imageFocus: "center",
        imageOpacity: 90,
        button: { show: true, label: "Shop now", link: { ...NO_LINK, type: "catalog" }, style: "solid", color: "", textColor: "" },
        background: colorBackground("#ECE6FB"),
        textColor: "",
      },
    ]);
  return (
    <>
      <IntlSellingSwitch intl={intl} homeLayout={homeLayout} />
      <Group title="Section heading" defaultOpen badge={m.show ? "On" : "Off"}>
        <Toggle label="Show “Shop your market”" value={m.show} onChange={(show) => set({ show })} />
        <TextField label="Title" value={m.title} onChange={(title) => set({ title })} />
        <TextField label="Description" value={m.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      </Group>
      <Notice tone="info">
        {`How markets work. Point a card's button at "A market's shop" to open that market's own shop page: Local sells in ${currency.code || currency.symbol}, International in USD at the prices you set per product. Prices are never converted by changing a label.`}
      </Notice>
      {m.cards.map((card, i) => (
        <MarketEditor
          key={card.id}
          card={card}
          index={i}
          count={m.cards.length}
          env={env}
          storeCurrency={currency}
          onChange={(next) => setCards((cards) => replaceAt(cards, i, next))}
          onMove={(d) => setCards((cards) => moveItem(cards, i, d))}
          onRemove={() => setCards((cards) => removeAt(cards, i))}
        />
      ))}
      {m.cards.length < IL_LIMITS.markets ? <Button label="Add market card" icon="add" variant="secondary" onPress={addCard} /> : null}
    </>
  );
}
