// Unit tests for ImageKit folder naming (src/lib/imagekit/folders.ts): a second
// server instance (Mama Mica) can file everything under its own top-level folder
// in the shared ImageKit account, while Pepweb's paths stay exactly as they are.
// Run: npm run test:media-folders
import assert from "node:assert/strict";
import { mediaFolderPrefix, onboardingFolder, tenantFolder } from "../src/lib/imagekit/folders";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("media-folders");

test("Pepweb (no prefix) keeps its existing /tenant/<slug> and /onboarding paths", () => {
  const prefix = mediaFolderPrefix({});
  assert.equal(prefix, "");
  assert.equal(tenantFolder("hpglow", prefix), "/tenant/hpglow");
  assert.equal(onboardingFolder(prefix), "/onboarding");
});

test("Mama Mica's instance files everything under /mamamica", () => {
  const prefix = mediaFolderPrefix({ IMAGEKIT_FOLDER_PREFIX: "/mamamica" });
  assert.equal(tenantFolder("mamamica", prefix), "/mamamica/tenant/mamamica");
  assert.equal(onboardingFolder(prefix), "/mamamica/onboarding");
});

test("the prefix is normalised: missing leading slash, trailing slash, whitespace", () => {
  assert.equal(mediaFolderPrefix({ IMAGEKIT_FOLDER_PREFIX: " mamamica/ " }), "/mamamica");
  assert.equal(mediaFolderPrefix({ IMAGEKIT_FOLDER_PREFIX: "/brands/mamamica" }), "/brands/mamamica");
  assert.equal(mediaFolderPrefix({ IMAGEKIT_FOLDER_PREFIX: "   " }), "");
});

test("an unsafe prefix fails loud instead of uploading somewhere unexpected", () => {
  for (const bad of ["../pepweb", "/mama mica", "/a//b", '/x" OR "1', "/MamaMica"]) {
    assert.throws(() => mediaFolderPrefix({ IMAGEKIT_FOLDER_PREFIX: bad }), /IMAGEKIT_FOLDER_PREFIX/, bad);
  }
});

test("a slug that isn't a safe path segment is still refused", () => {
  assert.throws(() => tenantFolder("../hpglow", ""), /slug/);
  assert.throws(() => tenantFolder("", "/mamamica"), /slug/);
});

console.log(`\n${passed} passed`);
