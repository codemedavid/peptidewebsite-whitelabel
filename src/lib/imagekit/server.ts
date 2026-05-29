import ImageKit from "imagekit";
import { prisma } from "@/lib/db/prisma";

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
 * only new uploads land under the slug folder.
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
  return `/tenant/${slug}`;
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
 * List a tenant's media, confined to its folder. Uses the private-key media
 * API (server-only), so callers can never reach beyond their own `path`.
 */
export async function listTenantMedia(tenantId: string, limit = 100) {
  const folder = await tenantMediaFolder(tenantId);
  return getImageKit().listFiles({ path: folder, limit });
}
