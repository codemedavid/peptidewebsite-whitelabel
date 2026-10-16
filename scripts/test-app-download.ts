// Self-contained test gate for the /download page's link resolution
// (src/marketing/app-download.ts). Pure — no DB.
//
//   npm run test:app-download

import { ANDROID_APK, ANDROID_PACKAGE, resolveAndroidDownload } from "../src/marketing/app-download";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

const bundled: string | null = ANDROID_APK.url || null;

// Env override wins over the bundled URL.
const override = resolveAndroidDownload({ ANDROID_APK_URL: "https://cdn.example.com/pepworld.apk" });
ok("env override wins", override.apkUrl === "https://cdn.example.com/pepworld.apk", String(override.apkUrl));

// Blank / whitespace env falls back to the bundled URL.
ok("blank env falls back", resolveAndroidDownload({ ANDROID_APK_URL: "  " }).apkUrl === bundled);

// Non-https and garbage are never served.
ok("http rejected", resolveAndroidDownload({ ANDROID_APK_URL: "http://x.com/a.apk" }).apkUrl === bundled);
ok("javascript: rejected", resolveAndroidDownload({ ANDROID_APK_URL: "javascript:alert(1)" }).apkUrl === bundled);
ok("garbage rejected", resolveAndroidDownload({ ANDROID_APK_URL: "not a url" }).apkUrl === bundled);

// The bundled URL itself must be https (or unset).
ok("bundled url is https", bundled === null || bundled.startsWith("https://"), String(bundled));

// Google Play stays hidden until explicitly flagged live.
ok("play hidden by default", resolveAndroidDownload({}).playStoreUrl === null);
ok("play hidden on junk flag", resolveAndroidDownload({ PLAY_STORE_LIVE: "yes" }).playStoreUrl === null);
for (const flag of ["1", "true"]) {
  const url = resolveAndroidDownload({ PLAY_STORE_LIVE: flag }).playStoreUrl;
  ok(`play shown on ${flag}`, url === `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`, String(url));
}

if (failures) {
  console.error(`\n${failures}/${checks} app-download checks failed`);
  process.exit(1);
}
console.log(`✓ app-download: ${checks} checks passed`);
