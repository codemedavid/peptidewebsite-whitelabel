import { useEffect, useMemo, useState } from "react";
import * as Font from "expo-font";
import type { MobileBrandFonts } from "@contract";
import { FONT, type FontSet } from "./tokens";

/**
 * The store's website fonts, downloaded at runtime from the TTF URLs /me sends
 * (Google Fonts, resolved server-side in src/lib/mobile/branding.ts).
 *
 * Until a file arrives — or if it never does (offline, blocked) — that role
 * keeps the bundled Instrument face, so text is never invisible and a font
 * failure is never an error screen. Family names are derived from the URL, so
 * two stores' "Inter" builds never collide and a re-sign-in is instant.
 */

type Slot = keyof MobileBrandFonts["files"];
type Loaded = Partial<Record<Slot, string>>;

const SLOTS: Slot[] = ["heading", "headingBold", "body", "bodyBold"];

/** Short stable family name for a font URL (djb2). */
function familyFor(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return `brand-${(h >>> 0).toString(36)}`;
}

function alreadyLoaded(files: MobileBrandFonts["files"]): Loaded {
  const out: Loaded = {};
  for (const slot of SLOTS) {
    const url = files[slot];
    if (url && Font.isLoaded(familyFor(url))) out[slot] = familyFor(url);
  }
  return out;
}

async function loadSlot(url: string): Promise<string> {
  const family = familyFor(url);
  if (!Font.isLoaded(family)) await Font.loadAsync({ [family]: url });
  return family;
}

/**
 * Website faces mapped onto the app's roles. The site ships regular + bold
 * only, so medium reads as regular and semibold as bold; headings have no
 * italic file, so the italic role uses the upright heading face.
 */
function toFontSet(l: Loaded): FontSet {
  const heading = l.heading ?? l.headingBold;
  const body = l.body ?? l.bodyBold;
  const bodyBold = l.bodyBold ?? l.body;
  return {
    serif: heading ?? FONT.serif,
    serifItalic: heading ?? FONT.serifItalic,
    sans: body ?? FONT.sans,
    sansMedium: body ?? FONT.sansMedium,
    sansSemi: bodyBold ?? FONT.sansSemi,
    sansBold: bodyBold ?? FONT.sansBold,
  };
}

export function useBrandFonts(fonts: MobileBrandFonts | null | undefined): FontSet {
  const files = useMemo(() => fonts?.files ?? {}, [fonts]);
  const key = SLOTS.map((s) => files[s] ?? "").join("|");
  // Downloaded faces, tagged with the store they belong to: a different store
  // falls back to what is already cached at once, never the previous store's.
  const [downloaded, setDownloaded] = useState<{ key: string; loaded: Loaded } | null>(null);
  const loaded = downloaded?.key === key ? downloaded.loaded : alreadyLoaded(files);

  useEffect(() => {
    let cancelled = false;
    const wanted = SLOTS.flatMap((slot) => (files[slot] ? [[slot, files[slot]!] as const] : []));
    if (!wanted.length) return;
    void Promise.allSettled(wanted.map(async ([slot, url]) => [slot, await loadSlot(url)] as const)).then(
      (results) => {
        if (cancelled) return;
        // A rejected slot is left out on purpose: it keeps the bundled face.
        const next: Loaded = {};
        for (const r of results) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
        setDownloaded({ key, loaded: next });
      },
    );
    return () => {
      cancelled = true;
    };
    // `key` captures every URL in `files`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadedKey = SLOTS.map((s) => loaded[s] ?? "").join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => toFontSet(loaded), [loadedKey]);
}
