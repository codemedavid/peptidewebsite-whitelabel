// Unit tests for the chat media size rules (mobile/src/features/community/lib/media.ts)
// and the thread poll back-off (lib/poll.ts).
// Run from the repo root:  npx tsx mobile/scripts/test-community-media.ts
import assert from "node:assert/strict";
import {
  PHOTO_MAX_EDGE,
  fullPhotoUrl,
  photoPlan,
  playableVideoUrl,
  sizedChatImage,
  thumbWidthFor,
} from "../src/features/community/lib/media";
import { POLL_FAST_MS, POLL_SLOW_MS, nextPollDelay } from "../src/features/community/lib/poll";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const IK = "https://ik.imagekit.io/pepweb/t/abc/community-photo.jpg";

console.log("photoPlan");
test("a big phone photo is shrunk on its long edge (landscape → width)", () => {
  assert.deepEqual(photoPlan({ mimeType: "image/jpeg", width: 4032, height: 3024, bytes: 3_800_000 }), {
    resize: { width: PHOTO_MAX_EDGE, height: null },
  });
});
test("a tall photo is shrunk by height", () => {
  assert.deepEqual(photoPlan({ mimeType: "image/heic", width: 3024, height: 4032, bytes: null }), {
    resize: { width: null, height: PHOTO_MAX_EDGE },
  });
});
test("a small JPEG that is already light is sent untouched", () => {
  assert.equal(photoPlan({ mimeType: "image/jpeg", width: 1080, height: 1350, bytes: 250_000 }), null);
});
test("a small but heavy PNG is re-encoded without resizing", () => {
  assert.deepEqual(photoPlan({ mimeType: "image/png", width: 1170, height: 2532, bytes: 2_400_000 }), {
    resize: { width: null, height: PHOTO_MAX_EDGE },
  });
  assert.deepEqual(photoPlan({ mimeType: "image/png", width: 900, height: 900, bytes: 1_200_000 }), { resize: null });
});
test("an unknown size is still re-encoded (never trusted as light)", () => {
  assert.deepEqual(photoPlan({ mimeType: "image/jpeg", width: null, height: null, bytes: null }), { resize: null });
});
test("GIFs are never touched (re-encoding drops the animation)", () => {
  assert.equal(photoPlan({ mimeType: "image/gif", width: 4000, height: 4000, bytes: 9_000_000 }), null);
});

console.log("thumbWidthFor");
test("rounds up to a shared bucket so many phones reuse one cached size", () => {
  assert.equal(thumbWidthFor(240, 3), 800);
  assert.equal(thumbWidthFor(240, 2), 480);
  assert.equal(thumbWidthFor(241, 2), 640);
});
test("never below the smallest bucket or above the cap", () => {
  assert.equal(thumbWidthFor(20, 1), 160);
  assert.equal(thumbWidthFor(600, 4), 960);
});

console.log("sizedChatImage / fullPhotoUrl");
test("ImageKit photos get a bounded, never-upscaled transform", () => {
  assert.equal(sizedChatImage(IK, 480), `${IK}?tr=w-480,c-at_max,q-70,f-auto`);
  assert.equal(fullPhotoUrl(IK), `${IK}?tr=w-${PHOTO_MAX_EDGE},c-at_max,q-80,f-auto`);
});
test("keeps an existing query and a hash", () => {
  assert.equal(sizedChatImage(`${IK}?v=2#x`, 160), `${IK}?v=2&tr=w-160,c-at_max,q-70,f-auto#x`);
});
test("leaves foreign hosts, data URLs and already-transformed URLs alone", () => {
  assert.equal(sizedChatImage("https://example.com/a.jpg", 480), "https://example.com/a.jpg");
  assert.equal(sizedChatImage("data:image/png;base64,AAAA", 480), "data:image/png;base64,AAAA");
  assert.equal(sizedChatImage(`${IK}?tr=w-100`, 480), `${IK}?tr=w-100`);
  assert.equal(sizedChatImage("file:///tmp/pick.jpg", 480), "file:///tmp/pick.jpg");
});
test("empty stays empty", () => {
  assert.equal(sizedChatImage(null, 480), null);
  assert.equal(sizedChatImage("", 480), null);
});

console.log("playableVideoUrl");
const VID = "https://ik.imagekit.io/pepweb/t/abc/community-welcome.mp4";
test("a portrait 1080p video plays at 720 wide", () => {
  assert.equal(playableVideoUrl({ url: VID, width: 1080, height: 1920 }), `${VID}?tr=w-720`);
});
test("a landscape 4K video plays at 720 tall", () => {
  assert.equal(playableVideoUrl({ url: VID, width: 3840, height: 2160 }), `${VID}?tr=h-720`);
});
test("a video already 720p or smaller, or of unknown size, plays as uploaded", () => {
  assert.equal(playableVideoUrl({ url: VID, width: 720, height: 1280 }), VID);
  assert.equal(playableVideoUrl({ url: VID, width: null, height: null }), VID);
});
test("non-ImageKit videos play as uploaded", () => {
  assert.equal(playableVideoUrl({ url: "data:video/mp4;base64,AAAA", width: 1920, height: 1080 }), "data:video/mp4;base64,AAAA");
});

console.log("nextPollDelay");
test("polls fast while the chat is active", () => {
  assert.equal(nextPollDelay(0), POLL_FAST_MS);
  assert.equal(nextPollDelay(3), POLL_FAST_MS);
});
test("backs off step by step while nothing happens", () => {
  const delays = [4, 6, 8, 10, 12, 14].map(nextPollDelay);
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1], `delay ${i} went down`);
  assert.ok(delays[0] > POLL_FAST_MS);
});
test("never waits longer than the slow ceiling", () => {
  assert.equal(nextPollDelay(1_000), POLL_SLOW_MS);
  assert.ok(POLL_SLOW_MS <= 15_000);
});

console.log(`\n${passed} passed`);
