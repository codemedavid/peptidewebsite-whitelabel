// The join page only renders for a shopper the server locked out. So when it
// learns they're now in (approved while they waited, or a stale page), the
// page it came with is out of date: reload once and they land in the round —
// on the HOME, not back on #groupbuy. Once they're in, the home catalog
// already lists the round's products, so reopening the separate pricing page
// showed the same products twice and read as a second shop.
// The guard stops a reload loop if a fresh page still comes back locked
// (e.g. a blocked cookie) — the shopper gets the "Open the group buy" button.

export const AUTO_OPEN_KEY = "sf.gbAutoOpen";
export const AUTO_OPEN_COOLDOWN_MS = 60_000;

export type AutoOpenMark = { id: string; at: number };

export function parseAutoOpenMark(raw: string | null): AutoOpenMark | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AutoOpenMark>;
    return typeof v.id === "string" && typeof v.at === "number" ? { id: v.id, at: v.at } : null;
  } catch {
    return null;
  }
}

/** Reload for this round unless we already did, moments ago. */
export function shouldAutoOpen(last: AutoOpenMark | null, groupBuyId: string, now: number): boolean {
  return !(last && last.id === groupBuyId && now - last.at < AUTO_OPEN_COOLDOWN_MS);
}

/** Where an approved member lands: the store home (the page minus its #hash). */
export function roundHomeUrl(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

/** Reload onto the home catalog, now unlocked. A plain reload would keep the
 *  #groupbuy hash; replaceState drops it first so Back doesn't return here. */
export function openRoundHome(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", roundHomeUrl(pathname, search));
  window.location.reload();
}

/** Browser side: reload into the round once. False = show the button instead
 *  (already tried, or storage is blocked so a loop couldn't be ruled out). */
export function autoOpenRound(groupBuyId: string): boolean {
  try {
    const now = Date.now();
    if (!shouldAutoOpen(parseAutoOpenMark(sessionStorage.getItem(AUTO_OPEN_KEY)), groupBuyId, now)) return false;
    sessionStorage.setItem(AUTO_OPEN_KEY, JSON.stringify({ id: groupBuyId, at: now }));
  } catch {
    return false;
  }
  openRoundHome();
  return true;
}
