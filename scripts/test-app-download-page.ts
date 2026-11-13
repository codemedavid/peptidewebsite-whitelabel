/**
 * Gate for the store /app page's pure rules (src/lib/mobile/app-download.ts):
 * download targets, visitor-device detection, mockup product picks and the QR.
 *
 *   npm run test:app-download-page
 */
import assert from "node:assert";
import qrcode from "qrcode-generator";

import {
  APP_STORE_URL,
  detectVisitorDevice,
  pickPreviewProducts,
  qrSvgPath,
  resolveAppDownloads,
  type PreviewProductRow,
} from "../src/lib/mobile/app-download";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  process.stdout.write(`  ✓ ${name}\n`);
}

console.info("app download page");

test("iOS defaults to the live App Store listing", () => {
  assert.equal(resolveAppDownloads({}).iosUrl, APP_STORE_URL);
});

test("Android stays unset (coming soon) without an env URL", () => {
  const d = resolveAppDownloads({});
  assert.equal(d.androidUrl, null);
  assert.equal(d.androidKind, null);
});

test("non-https or garbage env values never become a download link", () => {
  const d = resolveAppDownloads({
    NEXT_PUBLIC_MOBILE_IOS_URL: "http://evil.example/app.ipa",
    NEXT_PUBLIC_MOBILE_ANDROID_URL: "not a url",
  });
  assert.equal(d.iosUrl, APP_STORE_URL);
  assert.equal(d.androidUrl, null);
});

test("a Play link and a direct APK are told apart", () => {
  assert.equal(
    resolveAppDownloads({ NEXT_PUBLIC_MOBILE_ANDROID_URL: "https://play.google.com/store/apps/details?id=x" }).androidKind,
    "play",
  );
  assert.equal(resolveAppDownloads({ NEXT_PUBLIC_MOBILE_ANDROID_URL: "https://cdn.example/app.apk" }).androidKind, "apk");
});

test("device detection: iPhone, Android, desktop, missing UA", () => {
  assert.equal(
    detectVisitorDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS]"),
    "ios",
  );
  assert.equal(detectVisitorDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/120 Mobile"), "android");
  assert.equal(detectVisitorDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "desktop");
  assert.equal(detectVisitorDevice(null), "desktop");
});

const row = (name: string, extra: Partial<PreviewProductRow> = {}): PreviewProductRow => ({
  name,
  status: "active",
  images: [`https://ik.imagekit.io/x/${name}.jpg`],
  metadata: {},
  ...extra,
});

test("mockup picks live photographed products, featured first, capped", () => {
  const picks = pickPreviewProducts([
    row("a"),
    row("draft", { status: "draft" }),
    row("nophoto", { images: [] }),
    row("insecure", { images: ["http://x/y.jpg"] }),
    row("b"),
    row("star", { metadata: { featured: true } }),
    row("c"),
    row("d"),
  ]);
  assert.deepEqual(
    picks.map((p) => p.name),
    ["star", "a", "b", "c"],
  );
});

test("imageless products borrow the store's default product image", () => {
  const picks = pickPreviewProducts([row("plain", { images: [] })], "https://ik.imagekit.io/x/default.jpg");
  assert.deepEqual(picks, [{ name: "plain", image: "https://ik.imagekit.io/x/default.jpg" }]);
  assert.deepEqual(pickPreviewProducts([row("plain", { images: [] })], "http://insecure/default.jpg"), []);
});

test("QR path covers exactly the dark modules, inside the quiet zone", () => {
  const url = "https://vrjonina.pepweb.store/app";
  const { size, path } = qrSvgPath(url);
  const reference = qrcode(0, "M");
  reference.addData(url);
  reference.make();
  const count = reference.getModuleCount();
  assert.equal(size, count + 4);
  let dark = 0;
  for (let r = 0; r < count; r += 1) for (let c = 0; c < count; c += 1) if (reference.isDark(r, c)) dark += 1;
  assert.equal((path.match(/M/g) ?? []).length, dark);
  assert.ok(!path.includes("M0 ") && !path.includes("M1 "), "no module drawn in the quiet zone");
});

console.info(`\n${passed} passed`);
