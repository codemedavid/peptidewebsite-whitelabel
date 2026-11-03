// DEV-ONLY: the sample page's stand-in for the database. The editor's Save
// writes here and the sample website reads it, live across tabs (the storage
// event) — so the whole edit → save → see-it-on-the-site loop works locally
// without a store-admin session and without touching any real store.

import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import type { IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import type { UploadImageResult } from "@/actions/media";

const KEY = "intl-local-preview:v1";

export type SampleState = { config: IntlLocalConfig; active: boolean };

export function loadSample(fallback: IntlLocalConfig): SampleState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { config: fallback, active: true };
    const parsed = JSON.parse(raw) as { config?: unknown; active?: unknown };
    return { config: normalizeIntlLocalConfig(parsed.config), active: parsed.active !== false };
  } catch {
    return { config: fallback, active: true };
  }
}

export function saveSample(state: SampleState): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return null;
  } catch {
    return "This browser's storage is full — remove an image or two and try again.";
  }
}

/** Calls `cb` whenever ANOTHER tab saves the sample. */
export function onSampleChange(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Longest side tried first, then smaller ones until the image fits. A big
 *  photo is never refused — it just ends up lighter (real stores upload the
 *  original to ImageKit instead and are not bound by any of this). */
const SIDES = [1600, 1280, 1024, 800, 640];
const QUALITIES = [0.82, 0.68, 0.55];
/** Under the 500 KB inline-image cap (safeImageSrc), with room to spare so a
 *  handful of images still fit in this browser's storage. */
const MAX_DATA_URL = 420_000;

/** Read an image file into a compact data URL (downscaled, WebP), standing in
 *  for the ImageKit upload. */
export async function readSampleImage(file: File): Promise<UploadImageResult> {
  if (!file.type.startsWith("image/")) return { error: "Please pick an image file." };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: "Couldn't read that image — try a JPG or PNG." };
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "Couldn't read that image." };
  let smallest = "";
  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of QUALITIES) {
      const url = canvas.toDataURL("image/webp", q);
      if (url.length < MAX_DATA_URL) return { url };
      smallest = url;
    }
  }
  // Pathological noise that won't compress even at 640px: still accept it if
  // it squeezes under the hard cap, rather than refuse.
  return smallest && smallest.length < 500_000
    ? { url: smallest }
    : { error: "That image is too detailed to store on the sample page. It will upload fine on your real store." };
}
