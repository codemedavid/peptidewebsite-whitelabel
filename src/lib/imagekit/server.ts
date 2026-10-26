import ImageKit from "imagekit";
import { prisma } from "@/lib/db/prisma";
import { mediaFolderPrefix, onboardingFolder, tenantFolder } from "@/lib/imagekit/folders";

// Lazily constructed so importing this module (e.g. during build page-data
// collection) doesn't require the private key to be present.
let _imagekit: ImageKit | null = null;

export function getImageKit(): ImageKit {
  if (_imagekit) return _imagekit;
  _imagekit = new ImageKit({
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT!,
  });
  return _imagekit;
}

/**
 * The one place that decides where a tenant's media lives. Every read and write
 * is confined to this folder, so one tenant can never name, list, or overwrite
 * another's objects. We name the folder by the tenant's `slug` (e.g.
 * `/tenant/acme`) so it's recognizable in the ImageKit dashboard rather than an
 * opaque cuid. The slug is resolved here from the DB by the server-derived
 * tenantId — never smuggled in from the client — and is validated
 * (`^[a-z0-9-]{2,}$` at creation) so it's always a safe path segment. Existing
 * media uploaded under the old `/tenant/<cuid>` paths keeps its stored URLs;
 * only new uploads land under the slug folder. A server instance with
 * IMAGEKIT_FOLDER_PREFIX (Mama Mica: "/mamamica") nests it under that prefix —
 * see folders.ts.
 */
export async function tenantMediaFolder(tenantId: string): Promise<string> {
  if (!tenantId) throw new Error("tenantMediaFolder: missing tenantId");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  const slug = tenant?.slug;
  if (!slug || /[^A-Za-z0-9_-]/.test(slug)) {
    throw new Error(`tenantMediaFolder: no valid slug for tenant ${tenantId}`);
  }
  return tenantFolder(slug, mediaFolderPrefix(process.env));
}

/**
 * A server-side Upload API check that confines a client upload to the tenant's
 * own folder. ImageKit evaluates this against the request before storing the
 * file, rejecting anything outside `tenant/<id>`. The exact-match OR
 * trailing-slash-prefix form accepts the tenant root and any sub-folder beneath
 * it, while the trailing slash stops `tenant/acme` from also matching
 * `tenant/acme-2`. Takes the already-resolved folder (from `tenantMediaFolder`)
 * to avoid a second DB lookup.
 */
export function tenantUploadCheck(folder: string): string {
  const f = folder.replace(/^\//, ""); // "tenant/<slug>"
  return `"request.folder" = "${f}" OR "request.folder" : "${f}/"`;
}

/**
 * Upload auth for the ImageKit client SDK, scoped to one tenant. The signed
 * token only authorizes *an* upload (ImageKit signs token+expire, not the
 * folder or checks), so both are dictated here from the server session — never
 * chosen by the client. The `checks` string is defense-in-depth: ImageKit
 * rejects uploads landing outside the tenant folder, but since it isn't covered
 * by the V1 signature a determined client could still strip it. For uploads
 * that must be tamper-proof, prefer the server-side `uploadTenantMedia`.
 */
export async function getTenantUploadAuth(tenantId: string) {
  const folder = await tenantMediaFolder(tenantId);
  return {
    ...getImageKit().getAuthenticationParameters(),
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    folder,
    checks: tenantUploadCheck(folder),
  };
}

/**
 * Server-side upload. The folder is forced from tenantId, so the namespace
 * boundary holds even though the bytes came from the browser. Returns the
 * ImageKit response (`url`, `fileId`, …).
 */
export async function uploadTenantMedia(opts: {
  tenantId: string;
  file: Buffer | string;
  fileName: string;
  tags?: string[];
}) {
  const folder = await tenantMediaFolder(opts.tenantId);
  return getImageKit().upload({
    file: opts.file,
    fileName: opts.fileName,
    folder,
    useUniqueFileName: true,
    tags: opts.tags,
  });
}

/**
 * Pre-tenant upload for the public self-serve onboarding wizard. There is no
 * tenant yet (the store is provisioned only after the form is submitted), so
 * this lands files in a shared `/onboarding` folder instead of a tenant folder —
 * `uploadTenantMedia` can't be reused because `tenantMediaFolder` requires an
 * existing tenant slug and throws otherwise. The returned URL is later copied
 * verbatim into the tenant's Branding/Products at provision time.
 */
export async function uploadOnboardingMedia(opts: {
  file: Buffer | string;
  fileName: string;
  tags?: string[];
}) {
  return getImageKit().upload({
    file: opts.file,
    fileName: opts.fileName,
    folder: onboardingFolder(mediaFolderPrefix(process.env)),
    useUniqueFileName: true,
    tags: opts.tags ?? ["onboarding"],
  });
}

/**
 * List a tenant's media, confined to its folder. Uses the private-key media
 * API (server-only), so callers can never reach beyond their own `path`.
 */
export async function listTenantMedia(tenantId: string, limit = 100) {
  const folder = await tenantMediaFolder(tenantId);
  return getImageKit().listFiles({ path: folder, limit });
}

/** Are real ImageKit credentials present (not blank / placeholder)? */
export function isImageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

/**
 * Server-side upload of a PRIVATE file into a sub-folder of the tenant's own
 * folder. ImageKit refuses the original URL of a private file without a valid
 * signature, so the stored `filePath` is useless on its own — callers hand out
 * short-lived links via signedPrivateUrl, and only after their own access check.
 */
export async function uploadPrivateTenantFile(opts: {
  tenantId: string;
  subfolder: string;
  file: Buffer;
  fileName: string;
  tags?: string[];
}): Promise<{ fileId: string; filePath: string }> {
  if (!/^[a-z0-9-]+$/.test(opts.subfolder)) throw new Error("uploadPrivateTenantFile: bad subfolder");
  const folder = `${await tenantMediaFolder(opts.tenantId)}/${opts.subfolder}`;
  const res = await getImageKit().upload({
    file: opts.file,
    fileName: opts.fileName,
    folder,
    useUniqueFileName: true,
    isPrivateFile: true,
    tags: opts.tags,
  });
  return { fileId: res.fileId, filePath: res.filePath };
}

/** A signed link to a private file that stops working after `expireSeconds`. */
export function signedPrivateUrl(filePath: string, expireSeconds: number): string {
  return getImageKit().url({ path: filePath, signed: true, expireSeconds });
}
