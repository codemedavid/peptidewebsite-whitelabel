import { useSyncExternalStore } from "react";

// One shared minute ticker for every relative time label ("5m", "Yesterday").
// Only the small label components subscribe, so a chat list doesn't re-render
// every row each minute.

const MINUTE_MS = 60_000;
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, MINUTE_MS);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => now;

export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
