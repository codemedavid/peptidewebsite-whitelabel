/**
 * Member tag designs (pure rules, src/lib/community/tags.ts): how a store
 * dresses its Admin and Verified reseller tags, kept in
 * branding.config.communityTags.
 *
 *   npm run test:community-tags
 */
import assert from "node:assert/strict";
import { COMMUNITY_TAG_LABEL_MAX, DEFAULT_COMMUNITY_TAGS } from "../src/lib/mobile/contract";
import { communityTags, parseCommunityTagsInput } from "../src/lib/community/tags";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`  ✗ ${name}\n    ${(e as Error).message}`);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const admin = { label: "Mod", icon: "flash", color: "#E11D48", style: "solid", shape: "rounded" } as const;

console.log("community tags — stored config");
test("a store with nothing saved gets the default tags", () => {
  assert.deepEqual(communityTags(undefined), DEFAULT_COMMUNITY_TAGS);
  assert.deepEqual(communityTags({ communityTags: "junk" }), DEFAULT_COMMUNITY_TAGS);
});
test("a saved design comes back as saved", () => {
  const tags = communityTags({ communityTags: { admin } });
  assert.deepEqual(tags.admin, admin);
  assert.deepEqual(tags.reseller, DEFAULT_COMMUNITY_TAGS.reseller, "the other tag keeps its default");
});
test("bad stored fields fall back one by one, never the whole tag", () => {
  const tags = communityTags({ communityTags: { admin: { ...admin, color: "red", icon: "skull", style: "neon", shape: 3, label: "   " } } });
  assert.deepEqual(tags.admin, DEFAULT_COMMUNITY_TAGS.admin);
  const partial = communityTags({ communityTags: { admin: { ...admin, icon: "skull" } } });
  assert.equal(partial.admin.icon, DEFAULT_COMMUNITY_TAGS.admin.icon);
  assert.equal(partial.admin.color, "#E11D48");
});
test("icon null (text only) and color null (store colour) survive", () => {
  const tags = communityTags({ communityTags: { reseller: { ...admin, icon: null, color: null } } });
  assert.equal(tags.reseller.icon, null);
  assert.equal(tags.reseller.color, null);
});

console.log("community tags — edit request");
test("a full design for one tag is accepted and the other is kept", () => {
  const current = communityTags({ communityTags: { reseller: { ...admin, label: "VR" } } });
  const r = parseCommunityTagsInput({ tags: { admin } }, current);
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.deepEqual(r.value.admin, admin);
  assert.equal(r.value.reseller.label, "VR");
});
test("labels are trimmed and lower-case hex is normalised", () => {
  const r = parseCommunityTagsInput({ tags: { admin: { ...admin, label: "  Team  ", color: "#e11d48" } } }, DEFAULT_COMMUNITY_TAGS);
  assert.ok(r.ok);
  assert.equal(r.value.admin.label, "Team");
  assert.equal(r.value.admin.color, "#E11D48");
});
test("each bad field is refused with a message a person can act on", () => {
  const bad = (patch: Record<string, unknown>) => parseCommunityTagsInput({ tags: { admin: { ...admin, ...patch } } }, DEFAULT_COMMUNITY_TAGS);
  for (const [patch, msg] of [
    [{ label: "" }, /name/i],
    [{ label: "x".repeat(COMMUNITY_TAG_LABEL_MAX + 1) }, /20/],
    [{ color: "#12345" }, /colour/i],
    [{ color: "javascript:alert(1)" }, /colour/i],
    [{ icon: "skull" }, /icon/i],
    [{ style: "neon" }, /style/i],
    [{ shape: "blob" }, /shape/i],
  ] as const) {
    const r = bad(patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) assert.match(r.error, msg);
  }
});
test("unknown tags and empty requests are refused", () => {
  assert.equal(parseCommunityTagsInput({ tags: { owner: admin } }, DEFAULT_COMMUNITY_TAGS).ok, false);
  assert.equal(parseCommunityTagsInput({ tags: {} }, DEFAULT_COMMUNITY_TAGS).ok, false);
  assert.equal(parseCommunityTagsInput(null, DEFAULT_COMMUNITY_TAGS).ok, false);
});
test("extra fields are dropped, not stored", () => {
  const r = parseCommunityTagsInput({ tags: { admin: { ...admin, html: "<b>" } } }, DEFAULT_COMMUNITY_TAGS);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.value.admin).sort(), ["color", "icon", "label", "shape", "style"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
