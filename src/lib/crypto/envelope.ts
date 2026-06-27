// Envelope encryption for tenant integration credentials.
//
// TenantIntegration.encryptedCredentials stores { ciphertext, iv, tag } and
// TenantIntegration.dataKeyId records which key sealed it. We use AES-256-GCM
// keyed by the platform-wide ENCRYPTION_KEY (32-byte hex). GCM's auth tag means
// any tampering with the ciphertext, iv, or tag fails the decrypt LOUDLY rather
// than returning garbage — credentials never decrypt to a silently-wrong value.
//
// `dataKeyId` is a short fingerprint of the key that sealed the blob, so a key
// rotation is DETECTABLE (a blob sealed by the old key won't match the new key's
// fingerprint, and would also fail the GCM tag). Plaintext is NEVER logged.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce — the GCM standard

/** AES-256-GCM ciphertext envelope, all fields base64. Stored as Json. */
export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** A sealed secret ready to persist: the blob + the id of the key that sealed it. */
export interface SealedSecret {
  encryptedCredentials: EncryptedBlob;
  dataKeyId: string;
}

/**
 * Load the platform key from ENCRYPTION_KEY (32-byte hex) and derive a short,
 * non-secret fingerprint id for it. The fingerprint is a one-way SHA-256 prefix —
 * it never reveals the key but lets us tag each blob with which key sealed it, so
 * a key rotation is detectable (and decrypts of stale blobs fail with a clear
 * message instead of a confusing GCM error).
 */
function loadKey(): { key: Buffer; dataKeyId: string } {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars).");
  }
  const key = Buffer.from(hex, "hex");
  const dataKeyId = `env:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
  return { key, dataKeyId };
}

/** Seal a plaintext secret (e.g. a PostHog project key) for at-rest storage. */
export function encryptSecret(plaintext: string): SealedSecret {
  const { key, dataKeyId } = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedCredentials: {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    },
    dataKeyId,
  };
}

/**
 * Open a sealed secret. Throws if the blob was tampered with (GCM auth tag) or
 * was sealed by a different ENCRYPTION_KEY — it never returns a silently-wrong
 * value. Pass the stored `dataKeyId` to get a clearer rotation error before the
 * GCM check.
 */
export function decryptSecret(blob: EncryptedBlob, dataKeyId?: string): string {
  const { key, dataKeyId: current } = loadKey();
  if (dataKeyId && dataKeyId !== current) {
    throw new Error(
      `Credential was sealed by a different ENCRYPTION_KEY (${dataKeyId} != ${current}); cannot decrypt.`,
    );
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
