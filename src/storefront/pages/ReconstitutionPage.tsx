"use client";

import { useState } from "react";
import type { Brand } from "../types";
import { BackLink } from "../components/BackLink";

// Peptide reconstitution / dosing calculator. Pure client-side math — no store
// or server dependency. Given the vial strength, how much bacteriostatic water
// was added, and the target dose, it derives the concentration, the volume to
// draw, the insulin-syringe units (U-100), and how many doses the vial yields.

type DoseUnit = "mcg" | "mg";

// Insulin-syringe presets. U-100 means 100 units == 1 mL, so units = mL * 100.
const SYRINGES = [
  { label: '0.3 mL (30 units)', ml: 0.3 },
  { label: '0.5 mL (50 units)', ml: 0.5 },
  { label: '1.0 mL (100 units)', ml: 1.0 },
];

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  // Trim trailing zeros but keep it readable.
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// A simple side-on insulin syringe whose barrel fills (from the plunger end
// toward the needle) in proportion to the units drawn. Tick labels are spaced
// off the syringe's full capacity so the fill mark lands where a user would
// actually pull the plunger to. Over-capacity draws clamp to full + go amber.
function SyringeDiagram({ units, capacity, over }: { units: number; capacity: number; over: boolean }) {
  const ratio = capacity > 0 ? Math.min(units / capacity, 1) : 0;
  const X0 = 26;
  const X1 = 300;
  const W = X1 - X0;
  const Y0 = 26;
  const H = 38;
  const fillW = W * ratio;
  const fillRight = X0 + fillW;
  const step = capacity <= 30 ? 5 : capacity <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let u = 0; u <= capacity + 0.001; u += step) ticks.push(Math.round(u));

  return (
    <svg
      className="recon__syringe"
      viewBox="0 0 360 100"
      role="img"
      aria-label={`Insulin syringe filled to ${fmt(units, 1)} of ${capacity} units`}
    >
      {/* Plunger thumb rest + rod */}
      <rect x="2" y="33" width="9" height="22" rx="2" className="recon__sy-part" />
      <rect x="11" y="41.5" width="15" height="7" className="recon__sy-part" />
      {/* Barrel */}
      <rect x={X0} y={Y0} width={W} height={H} rx="7" className="recon__sy-barrel" />
      {/* Liquid */}
      {fillW > 0 && (
        <rect
          x={X0}
          y={Y0}
          width={fillW}
          height={H}
          rx="7"
          className={`recon__sy-fill ${over ? "is-over" : ""}`}
        />
      )}
      {/* Needle hub + needle */}
      <path d={`M${X1} ${Y0} L${X1 + 14} ${Y0 + 9} L${X1 + 14} ${Y0 + H - 9} L${X1} ${Y0 + H} Z`} className="recon__sy-part" />
      <line x1={X1 + 14} y1={Y0 + H / 2} x2="352" y2={Y0 + H / 2} className="recon__sy-needle" />
      {/* Tick marks + unit labels */}
      {ticks.map((u) => {
        const x = X0 + W * (u / capacity);
        return (
          <g key={u}>
            <line x1={x} y1={Y0 + H} x2={x} y2={Y0 + H + 6} className="recon__sy-tick" />
            <text x={x} y={Y0 + H + 18} className="recon__sy-label" textAnchor="middle">
              {u}
            </text>
          </g>
        );
      })}
      {/* Fill boundary marker */}
      {ratio > 0 && <line x1={fillRight} y1={Y0 - 7} x2={fillRight} y2={Y0 + H} className="recon__sy-marker" />}
    </svg>
  );
}

export function ReconstitutionPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const [vialMg, setVialMg] = useState("5");
  const [waterMl, setWaterMl] = useState("2");
  const [dose, setDose] = useState("250");
  const [doseUnit, setDoseUnit] = useState<DoseUnit>("mcg");
  const [syringeMl, setSyringeMl] = useState(SYRINGES[2].ml);

  const peptideMg = num(vialMg);
  const water = num(waterMl);
  const doseMcg = doseUnit === "mg" ? num(dose) * 1000 : num(dose);

  // Concentration of the reconstituted vial.
  const concMgPerMl = water > 0 ? peptideMg / water : 0;
  const concMcgPerMl = concMgPerMl * 1000;

  // Volume to draw for the requested dose, and what that is in syringe units.
  const drawMl = concMcgPerMl > 0 ? doseMcg / concMcgPerMl : 0;
  const drawUnits = drawMl * 100; // U-100
  const dosesPerVial = doseMcg > 0 ? (peptideMg * 1000) / doseMcg : 0;

  const ready = peptideMg > 0 && water > 0 && doseMcg > 0;
  // The dose can't physically exceed what a single full draw of the chosen
  // syringe can hold — flag it so users don't trust an off-scale number.
  const overSyringe = ready && drawUnits > syringeMl * 100 + 0.001;

  const results = [
    { label: "Concentration", value: `${fmt(concMgPerMl, 3)} mg/mL`, sub: `${fmt(concMcgPerMl, 0)} mcg/mL` },
    { label: "Draw volume", value: `${fmt(drawMl, 3)} mL`, sub: `for a ${fmt(doseMcg, 0)} mcg dose` },
    { label: "Syringe units", value: `${fmt(drawUnits, 1)} units`, sub: "on a U-100 insulin syringe" },
    { label: "Doses per vial", value: fmt(dosesPerVial, 1), sub: `at ${fmt(doseMcg, 0)} mcg each` },
  ];

  return (
    <section className="page" id="reconstitution">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.calculatorBackLabel || "Back to Home"} />

        <div className="protocols__intro">
          <span className="eyebrow">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M8 6h8M8 10h8M8 14h4" />
            </svg>
            {brand.calculatorEyebrow || "Dosing Tool"}
          </span>
          <h1 className="page__title" style={{ marginTop: 24 }}>
            {brand.calculatorTitle || "Reconstitution Calculator"}
          </h1>
          <p className="page__sub" style={{ margin: "16px auto 0" }}>
            {brand.calculatorSub ||
              "Work out the exact volume to draw after reconstituting a lyophilised peptide. Enter your vial strength, the bacteriostatic water you added, and your target dose."}
          </p>
        </div>

        <div className="recon__grid">
          {/* Inputs */}
          <div className="recon__panel">
            <div className="recon__field">
              <label htmlFor="recon-vial">Peptide in vial</label>
              <div className="recon__input-row">
                <input
                  id="recon-vial"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={vialMg}
                  onChange={(e) => setVialMg(e.target.value)}
                />
                <span className="recon__unit">mg</span>
              </div>
            </div>

            <div className="recon__field">
              <label htmlFor="recon-water">Bacteriostatic water added</label>
              <div className="recon__input-row">
                <input
                  id="recon-water"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={waterMl}
                  onChange={(e) => setWaterMl(e.target.value)}
                />
                <span className="recon__unit">mL</span>
              </div>
            </div>

            <div className="recon__field">
              <label htmlFor="recon-dose">Desired dose</label>
              <div className="recon__input-row">
                <input
                  id="recon-dose"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                />
                <div className="recon__toggle">
                  {(["mcg", "mg"] as DoseUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={`recon__toggle-btn ${doseUnit === u ? "is-active" : ""}`}
                      onClick={() => setDoseUnit(u)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="recon__field">
              <label htmlFor="recon-syringe">Syringe size</label>
              <select
                id="recon-syringe"
                className="recon__select"
                value={syringeMl}
                onChange={(e) => setSyringeMl(parseFloat(e.target.value))}
              >
                {SYRINGES.map((s) => (
                  <option key={s.ml} value={s.ml}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Results */}
          <div className="recon__panel recon__panel--results">
            {ready ? (
              <>
                <div className="recon__results">
                  {results.map((r) => (
                    <div key={r.label} className="recon__result">
                      <div className="eyebrow">{r.label}</div>
                      <strong>{r.value}</strong>
                      <span>{r.sub}</span>
                    </div>
                  ))}
                </div>
                <div className="recon__syringe-wrap">
                  <div className="eyebrow">Draw to this mark</div>
                  <SyringeDiagram units={drawUnits} capacity={syringeMl * 100} over={overSyringe} />
                </div>
                {overSyringe && (
                  <div className="recon__warn">
                    This dose needs <strong>{fmt(drawUnits, 1)} units</strong>, more than the{" "}
                    {fmt(syringeMl * 100, 0)}-unit syringe holds. Use a larger syringe, split the
                    dose, or add more water to dilute.
                  </div>
                )}
              </>
            ) : (
              <div className="recon__empty">
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3h6M10 9V3M14 9V3M10 9l-4.5 9a2 2 0 0 0 1.8 2.9h9.4a2 2 0 0 0 1.8-2.9L14 9" />
                </svg>
                <p>Fill in your vial strength, water, and dose to see the volume to draw.</p>
              </div>
            )}
          </div>
        </div>

        <p className="recon__disclaimer">
          {brand.calculatorDisclaimer ||
            "For research and educational purposes only. This calculator does not constitute medical advice — always verify dosing with a qualified professional."}
        </p>
      </div>
    </section>
  );
}
