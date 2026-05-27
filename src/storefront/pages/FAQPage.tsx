"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";

function FAQIcon({ name }: { name: string }) {
  const props = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "shipping")
    return (
      <svg {...props}>
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    );
  if (name === "payment")
    return (
      <svg {...props}>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    );
  if (name === "product")
    return (
      <svg {...props}>
        <path d="M32 4 6 16v32l26 12 26-12V16L32 4z" transform="scale(0.4) translate(2, 2)" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      </svg>
    );
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function FAQPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { faqGroups: groups } = useStore();
  const [activeCat, setActiveCat] = useState("all");

  const visible = activeCat === "all" ? groups : groups.filter((g) => g.id === activeCat);

  return (
    <section className="page" id="faq">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.faqBackLabel || "Back"} />

        <div className="page__head">
          <svg className="page__head-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
          </svg>
          <h1 className="page__title">{brand.faqTitle || "Frequently Asked Questions"}</h1>
        </div>

        <div className="faq__chips">
          <button className={`chip ${activeCat === "all" ? "is-active" : ""}`} onClick={() => setActiveCat("all")}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.id} className={`chip ${activeCat === g.id ? "is-active" : ""}`} onClick={() => setActiveCat(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="faq__rule" />

        {visible.map((g) => (
          <div key={g.id}>
            <div className="faq__group-head">
              <FAQIcon name={g.icon} />
              {g.label?.toUpperCase()}
            </div>
            <div className="faq__list">
              {(g.items || []).map((item, i) => (
                <details key={i} className="faq__item">
                  <summary className="faq__q">
                    {item.q}
                    <svg className="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <div className="faq__a">{item.a}</div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
