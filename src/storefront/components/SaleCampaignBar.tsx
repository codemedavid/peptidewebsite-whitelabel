"use client";

// The Sale Campaign's countdown strip across the top of the storefront —
// "11.11 Mega Sale starts in 2d 04:11:09" during the teaser, then "… is LIVE ·
// ends in 03:12:44". The window comes from the server (brand.saleCampaign);
// the phase is decided HERE, against this browser's clock, because the
// storefront render is cached and can't know what time it is.
//
// When the phase flips (teaser → live, live → ended) the catalog is refreshed
// once, so campaign-only sale prices appear and disappear on screen at the
// same moment the clock says they start and stop — not on the shopper's next
// click. Digits render after mount only (server and browser clocks never match,
// so SSR digits would be a hydration mismatch).

import { useEffect, useRef, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import {
  campaignCountdownParts,
  campaignPhase,
  type CampaignPhase,
} from "@/lib/storefront/sale-campaign";

const TICK_MS = 1000;
const pad = (n: number) => String(n).padStart(2, "0");

type Props = { brand: Brand };

function clockText(target: string, now: number): string {
  const p = campaignCountdownParts(target, now);
  const hms = `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}`;
  return p.days > 0 ? `${p.days}d ${hms}` : hms;
}

export function SaleCampaignBar({ brand }: Props) {
  const { refreshProducts } = useStore();
  const [now, setNow] = useState<number | null>(null);
  const lastPhase = useRef<CampaignPhase | null>(null);
  const campaign = brand.saleCampaign;
  const entitled = brand.saleCampaignEntitled === true;

  useEffect(() => {
    if (!entitled || !campaign?.enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [entitled, campaign?.enabled]);

  const phase: CampaignPhase = now === null ? "off" : campaignPhase(campaign, entitled, now);

  useEffect(() => {
    if (now === null) return;
    if (lastPhase.current !== null && lastPhase.current !== phase) refreshProducts();
    lastPhase.current = phase;
  }, [phase, now, refreshProducts]);

  if (!campaign || campaign.showBar === false || now === null) return null;
  if (phase !== "teaser" && phase !== "live") return null;

  const live = phase === "live";
  const target = live ? campaign.endsAt : campaign.startsAt;
  const when = new Date(target).toLocaleString();

  return (
    <aside className="sf-campaign-bar" data-phase={phase} aria-label={campaign.name}>
      <p className="sf-campaign-bar__inner">
        <span className="sf-campaign-bar__name">{campaign.name}</span>
        {live && <span className="sf-campaign-bar__live">Live</span>}
        <span className="sf-campaign-bar__label">{live ? "ends in" : "starts in"}</span>
        <time
          className="sf-campaign-bar__clock"
          dateTime={target}
          role="timer"
          aria-label={`${live ? "Ends" : "Starts"} ${when}`}
        >
          {clockText(target, now)}
        </time>
      </p>
    </aside>
  );
}
