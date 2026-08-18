"use client";

// Store-admin controls for the owner-selectable home LAYOUTS.
//
// Two things live here, and only two, because these layouts deliberately own no
// other content: which home layout the store uses, and the owner's own
// assurance lines. The strip ships EMPTY — a default promise ("Guaranteed
// authentic", "Free shipping") would put words in every tenant's mouth, and a
// supplement store, a bakery and a boutique do not make the same claims.
//
// The assurance lines are shared by the boutique and editorial layouts (the
// editorial layout sets them as its notices strip), so an owner who typed them
// once keeps them when they switch between the two.

import type { Brand } from "../types";
import type { SetTweak } from "./BrandTweaksForm";
import { TweakSection, TweakRow, TweakSelect, TweakText, TweakButton } from "./controls";
import {
  ASSURANCE_MAX,
  ASSURANCE_LABEL_MAX,
  ASSURANCE_NOTE_MAX,
  normalizeAssurances,
  type BoutiqueAssurance,
} from "@/lib/storefront/boutique-home";

/** The layouts an OWNER may pick for themselves. "two-ways" is deliberately
 *  absent: it is a sold module whose grant lives with the operator, so offering
 *  it here would be a control that silently does nothing for most tenants. */
const OWNER_LAYOUTS: Record<string, Brand["homeLayout"]> = {
  "Classic — hero, category chips, catalog": "classic",
  "Boutique — banner, category tiles, catalog": "boutique",
  "Editorial — side menu, category index, catalog": "editorial",
};

/** Shown, but not selectable, for a tenant the operator granted it to — so
 *  opening this panel can never silently downgrade their home. */
const TWO_WAYS_LABEL = "Two ways to order (granted by your provider)";

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

      {(layout === "boutique" || layout === "editorial") && (
        <>
          <TweakSection
            label={layout === "editorial" ? "Editorial: notices strip" : "Boutique: assurance strip"}
          />
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
        </>
      )}
    </>
  );
}
