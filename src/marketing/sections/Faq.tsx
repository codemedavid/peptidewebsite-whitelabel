"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQS } from "@/marketing/config";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="mk-section" id="faq">
      <div className="mk-container">
        <div className="mk-section-head mk-center">
          <span className="mk-eyebrow">Good to know</span>
          <h2 className="mk-h2">Frequently asked questions</h2>
        </div>
        <div className="mk-faq">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} className="mk-faq-item" data-open={isOpen}>
                <button
                  type="button"
                  className="mk-faq-q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  {f.q}
                  <ChevronDown size={20} />
                </button>
                {isOpen && <div className="mk-faq-a">{f.a}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
