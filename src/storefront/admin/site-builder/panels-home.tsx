"use client";

// Website Layout editor — the HOME panels: Hero, Markets, and Sections (the
// section order, Learn & explore cards, Community band, Newsletter + its
// subscriber list, and any custom sections). Same contract as panels-site:
// each edits its slice of the draft through `update`.

import { useEffect, useState } from "react";
import {
  IL_LIMITS,
  newCustomSection,
  type IlBand,
  type IlCard,
  type IlMarketCard,
  type IntlLocalConfig,
} from "@/lib/storefront/intl-local/config";
import { NO_LINK } from "@/lib/storefront/intl-local/links";
import { colorBackground } from "@/lib/storefront/section-background";
import { formatMoney, normalizeCurrency } from "@/lib/storefront/currency";
import type { NewsletterSubscriber } from "@/actions/intl-local";
import { useSiteBuilderEnv } from "./env";
import { BackgroundEditor, CardColorInput } from "./BackgroundEditor";
import {
  ButtonEditor,
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
} from "./fields";
import type { PanelProps } from "./panels-site";

export function HeroPanel({ cfg, update, env }: PanelProps) {
  const h = cfg.hero;
  const set = (patch: Partial<IntlLocalConfig["hero"]>) => update((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  return (
    <>
      <Group title="Hero text" defaultOpen badge={h.show ? "On" : "Off"}>
        <Toggle label="Show the hero" checked={h.show} onChange={(show) => set({ show })} />
        <TextInput label="Eyebrow / tagline" value={h.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
        <TextInput label="Title" value={h.title} max={IL_LIMITS.short * 2} onChange={(title) => set({ title })} />
        <TextInput label="Description" value={h.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
        <div className="admin-form__row">
          <SelectInput
            label="Text alignment"
            value={h.align}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centered" },
            ]}
            onChange={(align) => set({ align })}
          />
          <ColorInput label="Text colour" value={h.textColor} onChange={(textColor) => set({ textColor })} />
        </div>
      </Group>

      <Group title="Hero image">
        <ImageInput label="Desktop image" value={h.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
        <ImageInput label="Phone image (optional)" value={h.mobileImageUrl} hint="Shown on small screens instead of the desktop image." onChange={(mobileImageUrl) => set({ mobileImageUrl })} />
        <TextInput label="Image description (for screen readers)" value={h.imageAlt} max={IL_LIMITS.long} onChange={(imageAlt) => set({ imageAlt })} />
        <SelectInput
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
            onChange={(btn) => set({ buttons: replaceAt(h.buttons, i, btn) })}
          />
        </Group>
      ))}

      <BackgroundEditor title="Hero background" value={h.background} textColor={h.textColor} onChange={(background) => set({ background })} />
    </>
  );
}

function MarketEditor({
  card,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  env,
  storeCurrency,
}: {
  card: IlMarketCard;
  index: number;
  count: number;
  onChange: (c: IlMarketCard) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  env: PanelProps["env"];
  storeCurrency: { code: string; symbol: string };
}) {
  const set = (patch: Partial<IlMarketCard>) => onChange({ ...card, ...patch });
  const linksInternally = card.button.link.type === "catalog" || (card.button.link.type === "page" && card.button.link.page === "catalog");
  const mismatch = linksInternally && card.currency.trim() && card.currency.trim().toUpperCase() !== storeCurrency.code.toUpperCase();
  return (
    <Group title={`${card.title || "Market"}${card.currency ? ` · ${card.currency}` : ""}`} badge={card.show ? "Shown" : "Hidden"}>
      <div className="sb-row__head">
        <Toggle label="Show this card" checked={card.show} onChange={(show) => set({ show })} />
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={card.title || "market"} />
      </div>
      <TextInput label="Market label" value={card.eyebrow} onChange={(eyebrow) => set({ eyebrow })} />
      <div className="admin-form__row">
        <TextInput label="Title" value={card.title} onChange={(title) => set({ title })} />
        <TextInput label="Currency label" value={card.currency} max={12} onChange={(currency) => set({ currency })} />
      </div>
      <TextInput label="Description" value={card.description} max={IL_LIMITS.long} onChange={(description) => set({ description })} />
      <div className="admin-form__row">
        <CardColorInput value={card.background} onChange={(background) => set({ background })} />
        <ColorInput label="Text colour" value={card.textColor} onChange={(textColor) => set({ textColor })} />
      </div>
      {mismatch && (
        <p className="sb-warn" role="note">
          This card opens this store&apos;s catalog, which prices in {storeCurrency.code} ({formatMoney(1000, storeCurrency.symbol)}) — not{" "}
          {card.currency}. Point the button at your {card.currency} store with a custom link, or change the label.
        </p>
      )}
      <IconPicker value={card.icon} onChange={(icon) => set({ icon })} />
      <ImageInput
        label="Card image (photo, flag, map…)"
        value={card.imageUrl}
        onChange={(imageUrl) =>
          // A first upload fills the whole card, soft, under the text; a
          // replacement keeps whatever the owner already chose.
          set(card.imageUrl || !imageUrl ? { imageUrl } : { imageUrl, imageBlend: "cover", imageOpacity: 35 })
        }
      />
      {card.imageUrl && (
        <>
          <SelectInput
            label="How it sits on the card"
            value={card.imageBlend}
            options={[
              { value: "blend", label: "Blend into the card (hides white backgrounds)" },
              { value: "cover", label: "Fill the card — a background under the text" },
              { value: "watermark", label: "Watermark — large and faint, behind the text" },
              { value: "normal", label: "Show as uploaded" },
            ]}
            onChange={(imageBlend) =>
              // A watermark or full-card image reads best soft, so the text
              // stays the highlight; switching to one starts it there.
              set({
                imageBlend,
                imageOpacity:
                  imageBlend === card.imageBlend
                    ? card.imageOpacity
                    : imageBlend === "watermark"
                      ? 18
                      : imageBlend === "cover"
                        ? 35
                        : card.imageBlend === "cover" || card.imageBlend === "watermark"
                          ? 90
                          : card.imageOpacity,
              })
            }
          />
          <div className="admin-form__row">
            {card.imageBlend === "cover" && (
              <SelectInput
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
            )}
            {card.imageBlend !== "cover" && (
            <SelectInput
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
            <Slider
              label="Image opacity"
              value={card.imageOpacity}
              onChange={(imageOpacity) => set({ imageOpacity })}
              hint={card.imageBlend === "cover" ? "Lower keeps your text the highlight — 25–45% works for most photos." : undefined}
            />
          </div>
        </>
      )}
      <ButtonEditor title="Button" btn={card.button} env={env} onChange={(button) => set({ button })} />
      <BackgroundEditor title="More background options" value={card.background} textColor={card.textColor} onChange={(background) => set({ background })} />
    </Group>
  );
}

/** The store-level switch for selling in USD. In the store admin it saves the
 *  moment it's flipped (it changes how checkout works); in the platform admin
 *  it rides "Save branding" like everything else there (see ./env). */
function IntlSellingSwitch({ brand }: { brand: PanelProps["brand"] }) {
  const { intl, toast } = useSiteBuilderEnv();
  const [busy, setBusy] = useState(false);
  const on = intl.enabled;
  const flip = async (enabled: boolean) => {
    setBusy(true);
    try {
      const res = await intl.setEnabled(enabled);
      if ("error" in res) return toast(res.error);
      if (intl.savesImmediately) toast(enabled ? "International shop is on" : "International shop is off");
    } catch {
      toast("Couldn't save — please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="International shop (USD)" defaultOpen badge={on ? "On" : "Off"}>
      <Toggle
        label="Sell internationally in USD"
        checked={on}
        onChange={(v) => void (!busy && flip(v))}
        hint={
          intl.savesImmediately
            ? "Saves right away. Adds a separate International shop and cart that charge in USD."
            : "Adds a separate International shop and cart that charge in USD. Saved with Save branding."
        }
      />
      {on && (
        <ol className="sb-steps">
          <li><strong>Products</strong> — set each product to Local, International or Both and give it a USD price (Manage Products → Markets).</li>
          <li><strong>Payments</strong> — tick which methods the International cart offers (Payments).</li>
          <li><strong>Shipping</strong> — add your International rates in USD (Shipping → International rates).</li>
          <li><strong>Fees & promos</strong> — optional USD amounts (Checkout Fee, Promo Codes).</li>
        </ol>
      )}
      {on && brand.homeLayout !== "intl-local" && (
        <p className="sb-warn" role="note">The International shop opens once this store uses the Intl &amp; Local layout.</p>
      )}
    </Group>
  );
}

export function MarketsPanel({ cfg, update, env, brand }: PanelProps) {
  const m = cfg.markets;
  const set = (patch: Partial<IntlLocalConfig["markets"]>) => update((c) => ({ ...c, markets: { ...c.markets, ...patch } }));
  const currency = normalizeCurrency(brand.currency);
  return (
    <>
      <IntlSellingSwitch brand={brand} />
      <Group title="Section heading" defaultOpen badge={m.show ? "On" : "Off"}>
        <Toggle label="Show “Shop your market”" checked={m.show} onChange={(show) => set({ show })} />
        <TextInput label="Title" value={m.title} onChange={(title) => set({ title })} />
        <TextInput label="Description" value={m.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      </Group>
      <div className="sb-callout">
        <strong>How markets work.</strong> Point a card&apos;s button at &ldquo;A market&apos;s shop&rdquo; to open that market&apos;s
        own shop page: Local sells in {currency.code}, International in USD at the prices you set per product. Prices are
        never converted by changing a label.
      </div>
      {m.cards.map((card, i) => (
        <MarketEditor
          key={card.id}
          card={card}
          index={i}
          count={m.cards.length}
          env={env}
          storeCurrency={currency}
          onChange={(next) => set({ cards: replaceAt(m.cards, i, next) })}
          onMove={(d) => set({ cards: moveItem(m.cards, i, d) })}
          onRemove={() => set({ cards: removeAt(m.cards, i) })}
        />
      ))}
      {m.cards.length < IL_LIMITS.markets && (
        <button
          type="button"
          className="sb-add"
          onClick={() =>
            set({
              cards: [
                ...m.cards,
                {
                  id: newId("market", m.cards),
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
              ],
            })
          }
        >
          + Add market card
        </button>
      )}
    </>
  );
}

function LearnCardEditor({
  card,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  env,
}: {
  card: IlCard;
  index: number;
  count: number;
  onChange: (c: IlCard) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  env: PanelProps["env"];
}) {
  const set = (patch: Partial<IlCard>) => onChange({ ...card, ...patch });
  return (
    <Group title={card.title || "Card"} badge={card.show ? "Shown" : "Hidden"}>
      <div className="sb-row__head">
        <Toggle label="Show this card" checked={card.show} onChange={(show) => set({ show })} />
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} name={card.title || "card"} />
      </div>
      <TextInput label="Title" value={card.title} onChange={(title) => set({ title })} />
      <TextInput label="Description" value={card.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      <CardColorInput value={card.background} onChange={(background) => set({ background })} />
      <IconPicker value={card.icon} onChange={(icon) => set({ icon })} />
      <ImageInput label="Image instead of icon (optional)" value={card.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
      <ColorInput label="Icon circle colour" value={card.iconBg} onChange={(iconBg) => set({ iconBg })} />
      <TextInput label="Link text" value={card.ctaLabel} max={IL_LIMITS.label} hint="Leave blank for a card with no link." onChange={(ctaLabel) => set({ ctaLabel })} />
      {card.ctaLabel && <LinkEditor link={card.link} onChange={(link) => set({ link })} env={env} />}
      <ColorInput label="Text colour" value={card.textColor} onChange={(textColor) => set({ textColor })} />
      <BackgroundEditor title="Card background" value={card.background} textColor={card.textColor} onChange={(background) => set({ background })} />
    </Group>
  );
}

function BandEditor({ band, onChange, env, title }: { band: IlBand; onChange: (b: IlBand) => void; env: PanelProps["env"]; title: string }) {
  const set = (patch: Partial<IlBand>) => onChange({ ...band, ...patch });
  return (
    <>
      <Toggle label={`Show ${title}`} checked={band.show} onChange={(show) => set({ show })} />
      <TextInput label="Title" value={band.title} onChange={(t) => set({ title: t })} />
      <TextInput label="Description" value={band.description} max={IL_LIMITS.long} multiline onChange={(description) => set({ description })} />
      <CardColorInput label="Section colour" value={band.background} onChange={(background) => set({ background })} />
      <IconPicker value={band.icon} onChange={(icon) => set({ icon })} />
      <ImageInput label="Image instead of icon (optional)" value={band.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
      <ButtonEditor title="Button" btn={band.button} env={env} onChange={(button) => set({ button })} />
      <ColorInput label="Text colour" value={band.textColor} onChange={(textColor) => set({ textColor })} />
      <BackgroundEditor value={band.background} textColor={band.textColor} onChange={(background) => set({ background })} />
    </>
  );
}

function toCsv(rows: NewsletterSubscriber[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["email,subscribed_at", ...rows.map((r) => `${esc(r.email)},${esc(r.subscribedAt)}`)].join("\n");
}

function Subscribers() {
  const { toast, subscribers } = useSiteBuilderEnv();
  if (!subscribers) {
    return <p className="sb-sub">The subscriber list lives in the store&apos;s own admin (Website Layout → Sections → Newsletter).</p>;
  }
  return <SubscriberList api={subscribers} toast={toast} />;
}

function SubscriberList({
  api,
  toast,
}: {
  api: NonNullable<ReturnType<typeof useSiteBuilderEnv>["subscribers"]>;
  toast: (msg: string) => void;
}) {
  const [rows, setRows] = useState<NewsletterSubscriber[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .list()
      .then((res) => {
        if (!live) return;
        if ("error" in res) setError(res.error);
        else setRows(res.subscribers);
      })
      .catch(() => live && setError("Couldn't load subscribers."));
    return () => {
      live = false;
    };
  }, [api]);

  const download = () => {
    if (!rows) return;
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "newsletter-subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    const res = await api.unsubscribe(id);
    if ("error" in res) return toast(res.error);
    setRows((cur) => (cur ? cur.filter((r) => r.id !== id) : cur));
    toast("Unsubscribed");
  };

  if (error) return <p className="sb-warn">{error}</p>;
  if (!rows) return <p className="sb-sub">Loading subscribers…</p>;
  return (
    <div className="sb-subs">
      <div className="sb-subs__head">
        <strong>{rows.length} subscriber{rows.length === 1 ? "" : "s"}</strong>
        {rows.length > 0 && (
          <button type="button" className="sb-chip sb-chip--strong" onClick={download}>
            Download CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="sb-sub">No sign-ups yet. They appear here as soon as someone subscribes.</p>
      ) : (
        <ul className="sb-subs__list">
          {rows.slice(0, 50).map((r) => (
            <li key={r.id}>
              <span>{r.email}</span>
              <time dateTime={r.subscribedAt}>{new Date(r.subscribedAt).toLocaleDateString()}</time>
              <button type="button" className="sb-iconbtn sb-iconbtn--danger" aria-label={`Unsubscribe ${r.email}`} onClick={() => void remove(r.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 50 && <p className="sb-sub">Showing the latest 50 — download the CSV for everyone.</p>}
    </div>
  );
}

const SECTION_NAMES: Record<string, string> = {
  hero: "Hero",
  markets: "Shop your market",
  learn: "Learn & explore",
  community: "Community & reviews",
  newsletter: "Newsletter",
};

export function SectionsPanel({ cfg, update, env }: PanelProps) {
  const setLearn = (patch: Partial<IntlLocalConfig["learn"]>) => update((c) => ({ ...c, learn: { ...c.learn, ...patch } }));
  const setNews = (patch: Partial<IntlLocalConfig["newsletter"]>) => update((c) => ({ ...c, newsletter: { ...c.newsletter, ...patch } }));
  const sectionName = (key: string) =>
    SECTION_NAMES[key] ?? cfg.customSections.find((s) => `custom:${s.id}` === key)?.title ?? "Custom section";
  const n = cfg.newsletter;

  return (
    <>
      <Group title="Section order" defaultOpen>
        <ol className="sb-order">
          {cfg.order.map((key, i) => (
            <li key={key}>
              <span>{sectionName(key)}</span>
              <RowControls index={i} count={cfg.order.length} onMove={(d) => update((c) => ({ ...c, order: moveItem(c.order, i, d) }))} name={sectionName(key)} />
            </li>
          ))}
        </ol>
      </Group>

      <Group title="Learn & explore" badge={cfg.learn.show ? `${cfg.learn.cards.length} cards` : "Off"}>
        <Toggle label="Show this section" checked={cfg.learn.show} onChange={(show) => setLearn({ show })} />
        <TextInput label="Title" value={cfg.learn.title} onChange={(title) => setLearn({ title })} />
        <TextInput label="Description" value={cfg.learn.description} max={IL_LIMITS.long} onChange={(description) => setLearn({ description })} />
        {cfg.learn.cards.map((card, i) => (
          <LearnCardEditor
            key={card.id}
            card={card}
            index={i}
            count={cfg.learn.cards.length}
            env={env}
            onChange={(next) => setLearn({ cards: replaceAt(cfg.learn.cards, i, next) })}
            onMove={(d) => setLearn({ cards: moveItem(cfg.learn.cards, i, d) })}
            onRemove={() => setLearn({ cards: removeAt(cfg.learn.cards, i) })}
          />
        ))}
        {cfg.learn.cards.length < IL_LIMITS.cards && (
          <button
            type="button"
            className="sb-add"
            onClick={() =>
              setLearn({
                cards: [
                  ...cfg.learn.cards,
                  {
                    id: newId("card", cfg.learn.cards),
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
                  },
                ],
              })
            }
          >
            + Add card
          </button>
        )}
      </Group>

      <Group title="Community & reviews" badge={cfg.community.show ? "On" : "Off"}>
        <BandEditor title="this section" band={cfg.community} env={env} onChange={(community) => update((c) => ({ ...c, community }))} />
      </Group>

      <Group title="Newsletter" badge={n.show ? "On" : "Off"}>
        <Toggle label="Show the sign-up form" checked={n.show} onChange={(show) => setNews({ show })} />
        <TextInput label="Heading" value={n.title} onChange={(title) => setNews({ title })} />
        <TextInput label="Description" value={n.description} max={IL_LIMITS.long} onChange={(description) => setNews({ description })} />
        <div className="admin-form__row">
          <TextInput label="Email placeholder" value={n.placeholder} max={IL_LIMITS.label} onChange={(placeholder) => setNews({ placeholder })} />
          <TextInput label="Button text" value={n.buttonLabel} max={IL_LIMITS.label} onChange={(buttonLabel) => setNews({ buttonLabel })} />
        </div>
        <TextInput label="Thank-you message" value={n.successMessage} max={IL_LIMITS.long} onChange={(successMessage) => setNews({ successMessage })} />
        <IconPicker value={n.icon} onChange={(icon) => setNews({ icon })} />
        <ColorInput label="Text colour" value={n.textColor} onChange={(textColor) => setNews({ textColor })} />
        <BackgroundEditor value={n.background} textColor={n.textColor} onChange={(background) => setNews({ background })} />
        <p className="sb-sub">Sign-ups are saved to your store&apos;s contacts. Download them any time:</p>
        <Subscribers />
      </Group>

      <div className="sb-heading">
        <h3>Custom sections</h3>
        <p>Extra full-width bands — an announcement, a promo, a story. Reorder them above.</p>
      </div>
      {cfg.customSections.map((band, i) => (
        <Group key={band.id} title={band.title || "Custom section"} badge={band.show ? "On" : "Off"}>
          <div className="sb-row__head">
            <span className="sb-sub">Section {i + 1}</span>
            <RowControls
              index={i}
              count={cfg.customSections.length}
              onMove={(d) => update((c) => ({ ...c, customSections: moveItem(c.customSections, i, d) }))}
              onRemove={() =>
                update((c) => ({
                  ...c,
                  customSections: removeAt(c.customSections, i),
                  order: c.order.filter((k) => k !== `custom:${band.id}`),
                }))
              }
              name={band.title || "section"}
            />
          </div>
          <BandEditor
            title="this section"
            band={band}
            env={env}
            onChange={(next) => update((c) => ({ ...c, customSections: replaceAt(c.customSections, i, next) }))}
          />
        </Group>
      ))}
      {cfg.customSections.length < IL_LIMITS.customSections && (
        <button
          type="button"
          className="sb-add"
          onClick={() =>
            update((c) => {
              const id = newId("section", c.customSections);
              return { ...c, customSections: [...c.customSections, newCustomSection(id)], order: [...c.order, `custom:${id}`] };
            })
          }
        >
          + Add custom section
        </button>
      )}
    </>
  );
}
