"use client";

// Store-admin controls for the owner-selectable home LAYOUTS.
//
// Which home layout the store uses, the owner's own assurance lines, and the
// one composition choice the editorial layout exposes — how many featured cards
// sit on a row. Nothing else: these layouts deliberately own no content of
// their own. The assurance strip ships EMPTY — a default promise ("Guaranteed
// authentic", "Free shipping") would put words in every tenant's mouth, and a
// supplement store, a bakery and a boutique do not make the same claims.
//
// The assurance lines are shared by the boutique and editorial layouts (the
// editorial layout sets them as its notices strip), so an owner who typed them
// once keeps them when they switch between the two.

import type { Brand } from "../types";
import type { SetTweak } from "./BrandTweaksForm";
import {
  TweakSection,
  TweakRow,
  TweakSelect,
  TweakText,
  TweakToggle,
  TweakButton,
  ColorField,
} from "./controls";
import {
  EDIT_COLUMNS_LABEL,
  EDIT_COLUMNS_OPTIONS,
  editColumnsOption,
  normalizeEditColumns,
  offersEditColumns,
  setEditColumns,
} from "@/lib/storefront/editorial-home";
import {
  ASSURANCE_MAX,
  ASSURANCE_LABEL_MAX,
  ASSURANCE_NOTE_MAX,
  normalizeAssurances,
  normalizeBoutiqueContact,
  CONTACT_HEADING_MAX,
  type BoutiqueAssurance,
  type BoutiqueContact,
} from "@/lib/storefront/boutique-home";

/** The layouts an OWNER may pick for themselves. "two-ways" is deliberately
 *  absent: it is a sold module whose grant lives with the operator, so offering
 *  it here would be a control that silently does nothing for most tenants. */
const OWNER_LAYOUTS: Record<string, Brand["homeLayout"]> = {
  "Classic — hero, category chips, catalog": "classic",
  "Boutique — banner, category tiles, catalog": "boutique",
  "Editorial — side menu, category index, catalog": "editorial",
  "Showcase — promise bar, split hero, featured shelf": "showcase",
};

/** Shown, but not selectable, for a tenant the operator granted it to — so
 *  opening this panel can never silently downgrade their home. */
const TWO_WAYS_LABEL = "Two ways to order (granted by your provider)";

/** What each layout calls the owner's promise lines. One list, three ways of
 *  showing it — the showcase layout puts it in the bar above the header, the
 *  hero's trust row and the closing strip. */
const ASSURANCE_SECTION_LABEL: Record<string, string> = {
  boutique: "Boutique: assurance strip",
  editorial: "Editorial: notices strip",
  showcase: "Showcase: promise bar + trust strip",
};

function layoutLabel(layout: Brand["homeLayout"]): string {
  if (layout === "two-ways") return TWO_WAYS_LABEL;
  const found = Object.entries(OWNER_LAYOUTS).find(([, v]) => v === layout);
  return found?.[0] ?? Object.keys(OWNER_LAYOUTS)[0];
}

export function BoutiqueEditor({
  brand: t,
  setTweak,
}: {
  brand: Brand;
  setTweak: SetTweak;
}) {
  const layout = t.homeLayout ?? "classic";
  const options = Object.keys(OWNER_LAYOUTS);
  if (layout === "two-ways") options.unshift(TWO_WAYS_LABEL);

  const assurances = normalizeAssurances(t.boutique?.assurances);

  const write = (next: BoutiqueAssurance[]) =>
    setTweak("boutique", { ...(t.boutique ?? {}), assurances: next });

  const edit = (index: number, patch: Partial<BoutiqueAssurance>) =>
    write(assurances.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const contact = normalizeBoutiqueContact(t.boutique?.contact);
  const editContact = (patch: Partial<BoutiqueContact>) =>
    setTweak("boutique", { ...(t.boutique ?? {}), contact: { ...contact, ...patch } });

  return (
    <>
      <TweakSection label="Home layout" />
      <TweakSelect
        label="Layout"
        value={layoutLabel(layout)}
        options={options}
        onChange={(v) => {
          // Selecting the read-only two-ways row is a no-op rather than an
          // error — it is in the list to be seen, not to be chosen.
          const next = OWNER_LAYOUTS[v];
          if (next) setTweak("homeLayout", next);
        }}
      />

      {offersEditColumns(layout) && (
        <>
          <TweakSection label="Editorial: featured band" />
          <TweakSelect
            label={EDIT_COLUMNS_LABEL}
            value={editColumnsOption(normalizeEditColumns(t.editorial?.editColumns))}
            options={EDIT_COLUMNS_OPTIONS}
            onChange={(v) => setTweak("editorial", setEditColumns(t.editorial, v))}
          />
        </>
      )}

      {layout === "boutique" && (
        <>
          {/* "Questions before you order?" — the buttons open the store's
              active contact channels (set under checkout contact). */}
          <TweakSection label="Boutique: contact block" />
          <TweakToggle
            label="Show contact block"
            value={contact.show}
            onChange={(v) => editContact({ show: v })}
          />
          {contact.show && (
            <>
              <TweakText
                label="Heading"
                value={contact.heading}
                onChange={(v) => editContact({ heading: v.slice(0, CONTACT_HEADING_MAX) })}
              />
              <TweakToggle
                label="Show number / handle on buttons"
                value={contact.showDetails}
                onChange={(v) => editContact({ showDetails: v })}
              />
            </>
          )}
        </>
      )}

      {(layout === "boutique" || layout === "editorial" || layout === "showcase") && (
        <>
          <TweakSection label={ASSURANCE_SECTION_LABEL[layout]} />
          {assurances.length === 0 && (
            <TweakRow label="Assurances">
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                None yet — the strip is hidden until you add one.
              </span>
            </TweakRow>
          )}

          {assurances.map((item, i) => (
            <div key={item.id}>
              <TweakText
                label={`Assurance ${i + 1}`}
                value={item.label}
                onChange={(v) => edit(i, { label: v.slice(0, ASSURANCE_LABEL_MAX) })}
              />
              <TweakText
                label="Supporting line"
                value={item.note ?? ""}
                onChange={(v) => edit(i, { note: v.slice(0, ASSURANCE_NOTE_MAX) })}
              />
              <TweakButton
                label="Remove"
                onClick={() => write(assurances.filter((_, k) => k !== i))}
              />
            </div>
          ))}

          {assurances.length < ASSURANCE_MAX && (
            <TweakButton
              label="Add assurance"
              onClick={() =>
                write([
                  ...assurances,
                  { id: `assurance-${Date.now()}`, label: "New assurance" },
                ])
              }
            />
          )}

          {layout === "showcase" && (
            <>
              {/* The bar above the header. Unset = brand text colour behind
                  brand background text (always readable on any palette). */}
              <ColorField
                label="Promise bar background"
                value={t.promiseBarBg}
                optional
                fallback={t.text}
                inheritLabel="Inheriting Text colour"
                onChange={(v) => setTweak("promiseBarBg", v)}
                onClear={() => setTweak("promiseBarBg", undefined)}
                options={[t.text, t.main, t.button, t.accent].filter(Boolean)}
              />
              <ColorField
                label="Promise bar text"
                value={t.promiseBarText}
                optional
                fallback={t.background}
                inheritLabel="Inheriting Background"
                onChange={(v) => setTweak("promiseBarText", v)}
                onClear={() => setTweak("promiseBarText", undefined)}
                options={["#FFFFFF", t.background, t.text].filter(Boolean)}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
