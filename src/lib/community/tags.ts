// Member tags: how a store dresses its Admin and Verified reseller tags.
// Pure — npm run test:community-tags. tags.server.ts stores them in
// branding.config.communityTags; /me hands them to the app.

import {
  COMMUNITY_TAG_ICONS,
  COMMUNITY_TAG_LABEL_MAX,
  DEFAULT_COMMUNITY_TAGS,
  type CommunityTagDesign,
  type CommunityTagIcon,
  type CommunityTagRole,
  type CommunityTagShape,
  type CommunityTagStyle,
  type CommunityTags,
} from "@/lib/mobile/contract";

const ROLES: readonly CommunityTagRole[] = ["admin", "reseller"];
const STYLES: readonly CommunityTagStyle[] = ["soft", "solid", "outline"];
const SHAPES: readonly CommunityTagShape[] = ["pill", "rounded", "square"];
const HEX = /^#[0-9a-f]{6}$/i;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const isIcon = (v: unknown): v is CommunityTagIcon => typeof v === "string" && (COMMUNITY_TAG_ICONS as readonly string[]).includes(v);
const isStyle = (v: unknown): v is CommunityTagStyle => typeof v === "string" && (STYLES as readonly string[]).includes(v);
const isShape = (v: unknown): v is CommunityTagShape => typeof v === "string" && (SHAPES as readonly string[]).includes(v);
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

/** A stored design, read leniently: each bad field falls back to the default on its own. */
function storedDesign(v: unknown, fallback: CommunityTagDesign): CommunityTagDesign {
  const r = record(v);
  if (!r) return fallback;
  const label = typeof r.label === "string" ? r.label.trim().slice(0, COMMUNITY_TAG_LABEL_MAX) : "";
  return {
    label: label || fallback.label,
    icon: r.icon === null ? null : isIcon(r.icon) ? r.icon : fallback.icon,
    color: r.color === null ? null : isHex(r.color) ? r.color.toUpperCase() : fallback.color,
    style: isStyle(r.style) ? r.style : fallback.style,
    shape: isShape(r.shape) ? r.shape : fallback.shape,
  };
}

/** The store's tags, always complete. */
export function communityTags(config: unknown): CommunityTags {
  const saved = record(record(config)?.communityTags);
  return {
    admin: storedDesign(saved?.admin, DEFAULT_COMMUNITY_TAGS.admin),
    reseller: storedDesign(saved?.reseller, DEFAULT_COMMUNITY_TAGS.reseller),
  };
}

/** One design from an edit request, read strictly: any bad field refuses the save. */
function parseDesign(v: unknown): Result<CommunityTagDesign> {
  const r = record(v);
  if (!r) return { ok: false, error: "Pick a look for the tag." };
  const label = typeof r.label === "string" ? r.label.trim() : "";
  if (!label) return { ok: false, error: "Give the tag a name." };
  if (label.length > COMMUNITY_TAG_LABEL_MAX) return { ok: false, error: `Keep the tag name to ${COMMUNITY_TAG_LABEL_MAX} characters.` };
  if (r.icon !== null && !isIcon(r.icon)) return { ok: false, error: "Pick one of the icons, or none." };
  if (r.color !== null && !isHex(r.color)) return { ok: false, error: "Pick a colour, or type one like #7C3AED." };
  if (!isStyle(r.style)) return { ok: false, error: "Pick a style: soft, solid or outline." };
  if (!isShape(r.shape)) return { ok: false, error: "Pick a shape: pill, rounded or square." };
  return { ok: true, value: { label, icon: r.icon, color: r.color === null ? null : r.color.toUpperCase(), style: r.style, shape: r.shape } };
}

/** `{ tags: { admin?, reseller? } }` → the store's full tags after the change. */
export function parseCommunityTagsInput(body: unknown, current: CommunityTags): Result<CommunityTags> {
  const tags = record(record(body)?.tags);
  if (!tags) return { ok: false, error: "Nothing to save." };
  const keys = Object.keys(tags);
  if (keys.length === 0) return { ok: false, error: "Nothing to save." };
  if (keys.some((k) => !(ROLES as readonly string[]).includes(k))) return { ok: false, error: "Only the Admin and Verified reseller tags can be styled." };
  let next = current;
  for (const role of ROLES) {
    if (!(role in tags)) continue;
    const parsed = parseDesign(tags[role]);
    if (!parsed.ok) return parsed;
    next = { ...next, [role]: parsed.value };
  }
  return { ok: true, value: next };
}
