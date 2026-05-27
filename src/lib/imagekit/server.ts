import ImageKit from "imagekit";

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
 * another's objects. The tenantId is always server-derived (session/slug), so
 * the path can't be smuggled in from the client.
 */
export function tenantMediaFolder(tenantId: string): string {
  if (!tenantId || /[^A-Za-z0-9_-]/.test(tenantId)) {
    throw new Error("tenantMediaFolder: invalid tenantId");
  }
  return `/tenant/${tenantId}`;
}

/**
 * A server-side Upload API check that confines a client upload to the tenant's
 * own folder. ImageKit evaluates this against the request before storing the
 * file, rejecting anything outside `tenant/<id>`. The exact-match OR
 * trailing-slash-prefix form accepts the tenant root and any sub-folder beneath
 * it, while the trailing slash stops `tenant/1` from also matching `tenant/10`.
 */
export function tenantUploadCheck(tenantId: string): string {
  const folder = tenantMediaFolder(tenantId).replace(/^\//, ""); // "tenant/<id>"
  return `"request.folder" = "${folder}" OR "request.folder" : "${folder}/"`;
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
export function getTenantUploadAuth(tenantId: string) {
  return {
    ...getImageKit().getAuthenticationParameters(),
    publicKey: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY!,
    folder: tenantMediaFolder(tenantId),
    checks: tenantUploadCheck(tenantId),
  };
}

/**
 * Server-side upload. The folder is forced from tenantId, so the namespace
 * boundary holds even though the bytes came from the browser. Returns the
 * ImageKit response (`url`, `fileId`, …).
 */
export function uploadTenantMedia(opts: {
  tenantId: string;
  file: Buffer | string;
  fileName: string;
  tags?: string[];
}) {
  return getImageKit().upload({
    file: opts.file,
    fileName: opts.fileName,
    folder: tenantMediaFolder(opts.tenantId),
    useUniqueFileName: true,
    tags: opts.tags,
  });
}

/**
 * List a tenant's media, confined to its folder. Uses the private-key media
 * API (server-only), so callers can never reach beyond their own `path`.
 */
export function listTenantMedia(tenantId: string, limit = 100) {
  return getImageKit().listFiles({ path: tenantMediaFolder(tenantId), limit });
}
