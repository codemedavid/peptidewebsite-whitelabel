"use client";

import { useState, useId } from "react";
import { ChevronDown } from "lucide-react";
import type { Faq } from "./content";

/**
 * Accessible single-open FAQ accordion. Keyboard + screen-reader friendly:
 * each trigger is a real <button> with aria-expanded / aria-controls wired to
 * its panel. Mirrors the interaction pattern used by the marketing site's Faq.
 */
export function FaqAccordion({ items }: { items: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {items.map((f, i) => {
        const isOpen = open === i;
        const panelId = `${base}-panel-${i}`;
        const btnId = `${base}-btn-${i}`;
        return (
          <div
            key={f.q}
            className={`overflow-hidden rounded-2xl border bg-white transition-colors ${
              isOpen ? "border-rose-200 shadow-[0_8px_24px_rgba(176,52,94,0.08)]" : "border-zinc-200"
            }`}
          >
            <h3 className="m-0">
              <button
                id={btnId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold text-zinc-900 transition-colors hover:text-[#c43768] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e94b7d] focus-visible:ring-inset sm:px-6 sm:text-base"
              >
                {f.q}
                <ChevronDown
                  size={20}
                  aria-hidden
                  className={`shrink-0 text-[#e94b7d] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={btnId}
              hidden={!isOpen}
              className="px-5 pb-5 text-[15px] leading-relaxed text-zinc-600 sm:px-6"
            >
              {f.a}
            </div>
          </div>
        );
      })}
    </div>
  );
}
