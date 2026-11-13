// Where a shopper gets the PepWorld app, and which button to put first.
//
// Read by every store's /app page (src/app/(tenant)/(storefront)/app). PURE —
// no DB, no Next runtime — so `npm run test:app-download-page` pins the rules.
//
// iOS is live on the App Store, so it has a real default. Android has no
// public build yet (Play is in closed testing and the old sideload artifact
// expired), so it only appears when NEXT_PUBLIC_MOBILE_ANDROID_URL is set.

import qrcode from "qrcode-generator";

export const APP_NAME = "PepWorld";

/** The live App Store listing (ASC app 6818043518). */
export const APP_STORE_URL = "https://apps.apple.com/ph/app/pepworld-shop-community/id6818043518";

/** Lowest iOS the current build runs on (App Store `minimumOsVersion`). */
export const IOS_MIN_VERSION = "16.4";

export type AndroidKind = "play" | "apk";

export interface AppDownloads {
  iosUrl: string;
  androidUrl: string | null;
  /** Play listing vs a direct .apk — changes the button and install steps. */
  androidKind: AndroidKind | null;
}

/** Live download targets. Empty or non-https values count as unset, so a
 *  typo'd env var can never send a shopper to a non-TLS binary. */
export function resolveAppDownloads(env: Record<string, string | undefined> = process.env): AppDownloads {
  const iosUrl = httpsOrNull(env.NEXT_PUBLIC_MOBILE_IOS_URL) ?? APP_STORE_URL;
  const androidUrl = httpsOrNull(env.NEXT_PUBLIC_MOBILE_ANDROID_URL);
  return { iosUrl, androidUrl, androidKind: androidUrl ? androidKindOf(androidUrl) : null };
}

function androidKindOf(url: string): AndroidKind {
  return new URL(url).hostname === "play.google.com" ? "play" : "apk";
}

function httpsOrNull(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

export type VisitorDevice = "ios" | "android" | "desktop";

/** Which phone the visitor is holding, from the User-Agent. iPadOS 13+ claims
 *  to be a Mac, so an iPad lands on "desktop" — which still shows the App
 *  Store button, just alongside the QR code. */
export function detectVisitorDevice(userAgent: string | null | undefined): VisitorDevice {
  const ua = userAgent ?? "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "desktop";
}

/** The catalog-row fields the phone mockup reads. */
export interface PreviewProductRow {
  name: string;
  status: string;
  images: unknown;
  metadata: unknown;
}

export interface PreviewProduct {
  name: string;
  image: string;
}

/** Up to `limit` products to draw inside the mockup's shop screen: live
 *  listings (the storefront's own rule: status "active") with a photo, or the
 *  store's default product image when they have none; featured first. */
export function pickPreviewProducts(
  rows: readonly PreviewProductRow[],
  fallbackImage: string | null = null,
  limit = 4,
): PreviewProduct[] {
  const fallback = fallbackImage?.startsWith("https://") ? fallbackImage : null;
  const live = rows
    .filter((row) => row.status === "active")
    .map((row) => ({
      name: row.name,
      image: firstHttpsImage(row.images) ?? fallback,
      featured: isFeatured(row.metadata),
    }))
    .filter((p): p is { name: string; image: string; featured: boolean } => p.image !== null);
  const ordered = [...live.filter((p) => p.featured), ...live.filter((p) => !p.featured)];
  return ordered.slice(0, limit).map(({ name, image }) => ({ name, image }));
}

function firstHttpsImage(images: unknown): string | null {
  const first = Array.isArray(images) ? images[0] : null;
  return typeof first === "string" && first.startsWith("https://") ? first : null;
}

function isFeatured(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && (metadata as { featured?: unknown }).featured === true;
}

/** A QR code as one SVG path (1 unit per module, quiet zone included), so the
 *  page can draw it in the store's colours with no client JS and no image. */
export function qrSvgPath(text: string, quietZone = 2): { size: number; path: string } {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) parts.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }
  return { size: count + quietZone * 2, path: parts.join("") };
}
