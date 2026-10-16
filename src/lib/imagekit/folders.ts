// Where uploads land inside the ImageKit account. Pure (no DB, no SDK) so
// scripts/test-media-folders.ts can pin it down.
//
// One ImageKit account is shared by Pepweb and the Mama Mica server instance.
// IMAGEKIT_FOLDER_PREFIX files a whole instance under its own top-level folder
// (Mama Mica sets "/mamamica" → /mamamica/tenant/mamamica/…), so the dashboard
// shows at a glance which images belong to which app. Pepweb leaves it unset and
// its paths stay /tenant/<slug> and /onboarding.

const SAFE_PREFIX = /^(\/[a-z0-9_-]+)+$/;
const SAFE_SLUG = /^[A-Za-z0-9_-]+$/;

/** "" (no prefix) or a normalised "/a/b". Throws on anything that isn't plain lowercase segments. */
export function mediaFolderPrefix(env: Record<string, string | undefined>): string {
  const raw = (env.IMAGEKIT_FOLDER_PREFIX ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const prefix = raw.startsWith("/") ? raw : `/${raw}`;
  if (!SAFE_PREFIX.test(prefix)) {
    throw new Error(`IMAGEKIT_FOLDER_PREFIX must be lowercase folder names like "/mamamica" (got "${raw}")`);
  }
  return prefix;
}

/** A tenant's media folder. The slug is server-derived; it's re-checked here as a path segment. */
export function tenantFolder(slug: string, prefix: string): string {
  if (!SAFE_SLUG.test(slug)) throw new Error(`tenantFolder: not a valid slug "${slug}"`);
  return `${prefix}/tenant/${slug}`;
}

/** Pre-tenant uploads from the self-serve onboarding wizard. */
export function onboardingFolder(prefix: string): string {
  return `${prefix}/onboarding`;
}
