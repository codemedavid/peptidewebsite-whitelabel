import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { STOREFRONT_IMAGE_MAX_BYTES } from "@/lib/upload/limits";

export type McpImageAsset = Record<string, unknown>;

export type McpImageFile = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type LookupAddress = { address: string };
type AssetFetchDeps = {
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
};

const PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_BASE64_CHARS = Math.ceil(STOREFRONT_IMAGE_MAX_BYTES / 3) * 4 + 4;

function valueString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function mcpAssetFileName(asset: McpImageAsset, fallback: string): string {
  const raw = valueString(asset.fileName).slice(0, 180) || fallback;
  return raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function validateMcpPhotoFile(
  file: Pick<McpImageFile, "bytes" | "mimeType">,
  label: string,
): void {
  if (!file.bytes.length) throw new Error(`${label}: No file provided.`);
  if (file.bytes.length > STOREFRONT_IMAGE_MAX_BYTES) {
    throw new Error(`${label}: Image too large (max 10 MB).`);
  }
  if (!PHOTO_MIME_TYPES.has(file.mimeType.toLowerCase())) {
    throw new Error(`${label}: Unsupported type: ${file.mimeType || "unknown"}. Use JPG, PNG, or WebP.`);
  }
}

function decodeBase64(raw: string, label: string): Buffer {
  const compact = raw.replace(/\s+/g, "");
  if (!compact || compact.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error(`${label}: Invalid or oversized base64 image.`);
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) {
    throw new Error(`${label}: Invalid base64 image.`);
  }
  return bytes;
}

export function parseMcpDataImage(asset: McpImageAsset, label: string): McpImageFile | null {
  const dataUrl = valueString(asset.dataUrl);
  if (dataUrl) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);
    if (!match) throw new Error(`${label}: Invalid dataUrl image.`);
    const file = {
      mimeType: match[1].toLowerCase(),
      bytes: decodeBase64(match[2], label),
      fileName: mcpAssetFileName(asset, label),
    };
    validateMcpPhotoFile(file, label);
    return file;
  }

  const dataBase64 = valueString(asset.dataBase64);
  if (dataBase64) {
    const mimeType = valueString(asset.mimeType).toLowerCase();
    if (!mimeType) throw new Error(`${label}: Base64 images need a mimeType.`);
    const file = {
      mimeType,
      bytes: decodeBase64(dataBase64, label),
      fileName: mcpAssetFileName(asset, label),
    };
    validateMcpPhotoFile(file, label);
    return file;
  }

  return null;
}

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const version = isIP(normalized);
  if (version === 4) return privateIpv4(normalized);
  if (version !== 6) return true;

  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("2001:db8:")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped ? privateIpv4(mapped[1]) : false;
}

async function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function validatePublicMcpImageUrl(
  raw: unknown,
  label: string,
  lookup: (hostname: string) => Promise<LookupAddress[]> = defaultLookup,
): Promise<string> {
  const input = valueString(raw);
  if (!input || input.length > 2_000) throw new Error(`${label}: A public http(s) image URL is required.`);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${label}: A public http(s) image URL is required.`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`${label}: A public http(s) image URL is required.`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error(`${label}: Private or local image URLs are not allowed.`);
  }

  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [{ address: hostname }] : await lookup(hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error(`${label}: Private or local image URLs are not allowed.`);
  }
  return url.toString();
}

async function responseBytes(res: Response, label: string): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > STOREFRONT_IMAGE_MAX_BYTES) {
    throw new Error(`${label}: Image too large (max 10 MB).`);
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > STOREFRONT_IMAGE_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`${label}: Image too large (max 10 MB).`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function fetchMcpImageAsset(
  asset: McpImageAsset,
  label: string,
  deps: AssetFetchDeps = {},
): Promise<McpImageFile> {
  const data = parseMcpDataImage(asset, label);
  if (data) return data;

  const fetcher = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  let current = await validatePublicMcpImageUrl(asset.url, label, lookup);

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const res = await fetcher(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { Accept: "image/jpeg,image/png,image/webp" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error(`${label}: Too many image redirects.`);
      current = await validatePublicMcpImageUrl(new URL(location, current).toString(), label, lookup);
      continue;
    }
    if (!res.ok) throw new Error(`${label}: Could not download image (${res.status}).`);

    const file = {
      mimeType: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      bytes: await responseBytes(res, label),
      fileName: mcpAssetFileName(asset, new URL(current).pathname.split("/").pop() || label),
    };
    validateMcpPhotoFile(file, label);
    return file;
  }

  throw new Error(`${label}: Could not download image.`);
}
