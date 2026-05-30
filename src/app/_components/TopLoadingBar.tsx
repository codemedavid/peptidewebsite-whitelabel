"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A lightweight, dependency-free top loading/progress bar.
 *
 * It starts when an internal navigation begins (link click or back/forward)
 * and completes once the App Router finishes rendering the new route
 * (detected via a change in pathname or search params). Colors follow the
 * active tenant theme via the --primary / --accent CSS variables.
 */
function TopLoadingBarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    if (trickle.current) {
      clearInterval(trickle.current);
      trickle.current = null;
    }
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }, []);

  const done = useCallback(() => {
    clearTimers();
    setProgress(100);
    timeouts.current.push(setTimeout(() => setVisible(false), 350));
    timeouts.current.push(setTimeout(() => setProgress(0), 600));
  }, [clearTimers]);

  const start = useCallback(() => {
    clearTimers();
    setVisible(true);
    setProgress(8);
    // Slowly creep towards 90% so the bar always feels responsive.
    trickle.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + Math.max(0.5, (90 - p) * 0.08)));
    }, 200);
    // Failsafe: never let the bar hang forever.
    timeouts.current.push(setTimeout(() => done(), 10000));
  }, [clearTimers, done]);

  // Complete the bar whenever the route finishes changing.
  useEffect(() => {
    done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // Start the bar when a navigation begins.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.dataset.noProgress !== undefined
      ) {
        return;
      }

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      // Only animate same-origin navigations to a different URL.
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      start();
    };

    const onPopState = () => start();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      clearTimers();
    };
  }, [start, clearTimers]);

  return (
    <div
      aria-hidden
      className="top-loading-bar"
      data-visible={visible ? "true" : "false"}
    >
      <div
        className="top-loading-bar__progress"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export default function TopLoadingBar() {
  return (
    <Suspense fallback={null}>
      <TopLoadingBarInner />
    </Suspense>
  );
}
