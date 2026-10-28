// Admin shell display prefs (theme, collapsed sidebar), kept in cookies so the
// SERVER renders the right theme on first paint — localStorage is only readable
// after hydration, which flashed light mode at every dark-mode operator.
// Shared by the server layout (reads) and AdminShell (writes).

export type ShellTheme = "light" | "dark";
export type ShellPrefs = { theme: ShellTheme; collapsed: boolean };

export const THEME_COOKIE = "sa-theme";
export const COLLAPSED_COOKIE = "sa-collapsed";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Untrusted cookie values in → safe prefs out (light, expanded by default). */
export function parseShellPrefs(theme: string | undefined, collapsed: string | undefined): ShellPrefs {
  return { theme: theme === "dark" ? "dark" : "light", collapsed: collapsed === "1" };
}

/** A `document.cookie` assignment string for one pref. */
export function shellPrefCookie(name: typeof THEME_COOKIE | typeof COLLAPSED_COOKIE, value: string): string {
  return `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
