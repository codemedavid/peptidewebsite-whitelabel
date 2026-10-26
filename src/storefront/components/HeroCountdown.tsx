"use client";

// The hero's live group-buy timer ("GB #5 closes in 2d 04h 11m 09s"). The
// target and heading are resolved server-side (lib/storefront/hero-countdown);
// this only ticks the clock. Digits render after mount — the server's "now"
// and the browser's never match, so painting them during SSR would be a
// hydration mismatch. When the clock hits zero the page refreshes ONCE so the
// round's new state (open → closed, scheduled → live) replaces the timer.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { countdownParts, type HeroCountdown as HeroCountdownData } from "@/lib/storefront/hero-countdown";

const TICK_MS = 1000;

const pad = (n: number) => String(n).padStart(2, "0");

interface HeroCountdownProps {
  countdown: HeroCountdownData;
}

export function HeroCountdown({ countdown }: HeroCountdownProps) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [countdown.target]);

  const parts = now === null ? null : countdownParts(countdown.target, now);

  useEffect(() => {
    if (!parts?.done || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [parts?.done, router]);

  const units: { label: string; value: string }[] = [
    { label: "Days", value: parts ? String(parts.days) : "–" },
    { label: "Hours", value: parts ? pad(parts.hours) : "––" },
    { label: "Mins", value: parts ? pad(parts.minutes) : "––" },
    { label: "Secs", value: parts ? pad(parts.seconds) : "––" },
  ];

  const when = new Date(countdown.target);
  const verb = countdown.phase === "closing" ? "closes" : "opens";

  return (
    <div className="hero-countdown" data-phase={countdown.phase}>
      {countdown.heading && <p className="hero-countdown__heading">{countdown.heading}</p>}
      <time
        className="hero-countdown__clock"
        dateTime={countdown.target}
        role="timer"
        aria-label={`${countdown.roundName} ${verb} ${when.toLocaleString()}`}
      >
        {units.map((u) => (
          <span key={u.label} className="hero-countdown__unit" aria-hidden="true">
            <span className="hero-countdown__value">{u.value}</span>
            <span className="hero-countdown__label">{u.label}</span>
          </span>
        ))}
      </time>
    </div>
  );
}
