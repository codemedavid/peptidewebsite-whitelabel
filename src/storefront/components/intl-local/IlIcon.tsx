// Line icons for the Intl & Local layout. Every icon a card, band or the
// contact button can pick (IL_ICONS) plus the social glyphs — one stroke
// style, drawn in currentColor so they take the element's text colour.

import type { IlIcon as IlIconName, IlSocialPlatform } from "@/lib/storefront/intl-local/config";

const PATHS: Record<Exclude<IlIconName, "none">, string> = {
  truck: "M1 6h13v10H1zM14 10h4l3 3v3h-7zM5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  plane: "M10.5 13.5 3 11l1.5-1.5 8 .5 4.5-4.5a2 2 0 0 1 3 3L15.5 13l.5 8-1.5 1.5-2.5-7.5-3 3V20l-1.5 1.5-1-3.5L3 17l1.5-1.5H6z",
  book: "M3 5.5A2.5 2.5 0 0 1 5.5 3H11v17H5.5A2.5 2.5 0 0 0 3 22.5zM21 5.5A2.5 2.5 0 0 0 18.5 3H13v17h5.5a2.5 2.5 0 0 1 2.5 2.5z",
  file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6",
  tools: "M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8M3 21l6-6M5 3l4 4-2 2-4-4M9.5 9.5 12 12",
  flask: "M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3M7 15h10",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M23 21v-1a6 6 0 0 0-4-5.7",
  chat: "M21 12a8 8 0 0 1-11.8 7L3 21l2-5.6A8 8 0 1 1 21 12z",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  cart: "M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6",
  pin: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  leaf: "M11 20A7 7 0 0 1 4 13c0-6 6-10 16-10 0 10-4 16-10 16M2 22c3-4 6-7 11-9",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z",
};

export function IlIcon({ name, size = 24 }: { name: IlIconName; size?: number }) {
  if (name === "none") return null;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

const SOCIAL_PATHS: Record<IlSocialPlatform | "circle", string> = {
  facebook: "M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z",
  instagram: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01",
  youtube: "M22 8.2a3 3 0 0 0-2-2.1C18.2 5.6 12 5.6 12 5.6s-6.2 0-8 .5a3 3 0 0 0-2 2.1A31 31 0 0 0 1.6 12a31 31 0 0 0 .4 3.8 3 3 0 0 0 2 2.1c1.8.5 8 .5 8 .5s6.2 0 8-.5a3 3 0 0 0 2-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15V9l5.2 3z",
  tiktok: "M16 3c.4 2.4 1.9 3.9 4.5 4.2v3.2a7.6 7.6 0 0 1-4.4-1.4v6.3A5.7 5.7 0 1 1 10.4 9.6v3.3a2.5 2.5 0 1 0 2.4 2.5V3z",
  twitter: "M4 4l16 16M20 4 4 20",
  telegram: "M22 3 2 11l6 2.5L19 6l-9 9v5l3.5-3.5L18 20z",
  whatsapp: "M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.5zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a5 5 0 0 1-2.7-2.7l.8-1-1-2z",
  viber: "M12 2c5 0 9 3 9 8.5S17.2 19 12.5 19L9 22v-3.4C5 17.7 3 14.6 3 10.5 3 5 7 2 12 2zM9 7.5c0 4 3.5 7.5 7.5 7.5l.5-1.5-1.8-.9-.9.8a5 5 0 0 1-2.7-2.7l.8-.9-.9-1.8z",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
};

/** A social glyph; unknown names fall back to a plain circle. */
export function IlSocialIcon({ name, size = 18 }: { name: string; size?: number }) {
  const d = SOCIAL_PATHS[name as IlSocialPlatform] ?? SOCIAL_PATHS.circle;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
