// Pure responsive rules (no React Native import, so Node tests can load them).
// Hooks live in ./responsive.

/** The widest the whole app gets (header, tab bar, screens). */
export const APP_MAX_WIDTH = 1200;

/** The widest a single-column screen's content gets. */
export const READING_MAX_WIDTH = 640;

/** Grid breakpoints on the app's own width: 2 columns on phones, then 3, then 4. */
const GRID_BREAKPOINTS: readonly { minWidth: number; columns: number }[] = [
  { minWidth: 900, columns: 4 },
  { minWidth: 600, columns: 3 },
];
const PHONE_COLUMNS = 2;

/** The app's usable width for a given window width. */
export function appWidth(windowWidth: number): number {
  return Math.min(windowWidth, APP_MAX_WIDTH);
}

/** Product-grid columns for an app width. */
export function gridColumns(width: number): number {
  return GRID_BREAKPOINTS.find((b) => width >= b.minWidth)?.columns ?? PHONE_COLUMNS;
}

/** One tile's width: `columns` tiles plus the gaps between them, inside the side gutters. */
export function tileWidth(width: number, columns: number, gutter: number, gap: number): number {
  return Math.floor((width - gutter * 2 - gap * (columns - 1)) / columns);
}

/** Tabs that read as a single column: Chats, Orders and Me (customer app + store team). */
const READING_TABS = new Set(["community", "my-orders", "me", "chats", "orders", "more"]);

/** Screens opened from those tabs (chat threads, order detail, account screens). */
const READING_SCREENS = new Set([
  "profile",
  "password",
  "change-password",
  "notifications",
  "delete-account",
  "customers",
]);
const READING_PREFIXES = ["community/", "order/", "my-order/", "customer/", "customer-account/"];
/** Full-screen media (photo/video viewer) stays edge to edge. */
const FULL_BLEED_PREFIXES = ["community/media/"];

/** Should this route's screen sit in the centred READING_MAX_WIDTH column on wide screens? */
export function isReadingRoute(name: string): boolean {
  if (FULL_BLEED_PREFIXES.some((p) => name.startsWith(p))) return false;
  if (READING_TABS.has(name) || READING_SCREENS.has(name)) return true;
  return READING_PREFIXES.some((p) => name.startsWith(p));
}
