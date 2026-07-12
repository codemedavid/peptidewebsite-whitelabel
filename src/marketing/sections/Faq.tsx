"use client";

import { useState } from "react";
import { FAQS } from "@/marketing/config";

const ALL_CLOSED = -1;

export function Faq() {
  const [open, setOpen] = useState(ALL_CLOSED);
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
              <div key={f.q} className="mk-faq-item">
                <button
                  type="button"
                  className="mk-faq-q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? ALL_CLOSED : i)}
                >
                  {f.q}
                  <span className="mk-faq-ind" aria-hidden="true">
                    {isOpen ? "−" : "+"}
                  </span>
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
