// Where the PepWorld mobile app can be installed from. PURE module — read by
// the /download page and the /download/android short link.
//
// The APK is a direct sideload for Android users while the Google Play listing
// is in review. Once Play is live, set PLAY_STORE_LIVE=1 and the page leads
// with Google Play, keeping the APK as a secondary option.

export const APP_NAME = "PepWorld";
export const ANDROID_PACKAGE = "store.pepweb.admin";

/** Current sideload build. Bump alongside each `eas build --profile apk`. */
export const ANDROID_APK: { version: string; url: string; sizeLabel: string } = {
  version: "1.0.0",
  // EAS artifact of the latest `apk` profile build. Override with ANDROID_APK_URL
  // to point at a self-hosted copy without a code change.
  url: "https://expo.dev/artifacts/eas/-wqtmZZHLpEiLrIJyxWFICGpFH5vu0LNyltaqVZN3a4.apk",
  sizeLabel: "120 MB",
};

const PLAY_STORE_LISTING = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

export interface AndroidDownload {
  apkUrl: string | null;
  apkVersion: string;
  apkSizeLabel: string;
  playStoreUrl: string | null;
}

/** Resolves the live download targets. Empty / non-https values count as unset,
 *  so a typo'd env var can never send a visitor to a non-TLS binary. */
export function resolveAndroidDownload(env: Record<string, string | undefined> = process.env): AndroidDownload {
  const apkUrl = httpsOrNull(env.ANDROID_APK_URL) ?? httpsOrNull(ANDROID_APK.url);
  const playLive = env.PLAY_STORE_LIVE === "1" || env.PLAY_STORE_LIVE === "true";
  return {
    apkUrl,
    apkVersion: ANDROID_APK.version,
    apkSizeLabel: ANDROID_APK.sizeLabel,
    playStoreUrl: playLive ? PLAY_STORE_LISTING : null,
  };
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
