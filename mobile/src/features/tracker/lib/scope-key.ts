/**
 * The phone's AsyncStorage keys for one account's tracker. The session scope
 * is `<store>:<mode>:<email>` — the email must not sit in key names (backups,
 * debug dumps), so keys use a short stable hash of it instead. Pure.
 */

/** FNV-1a 32-bit with a given offset basis, as 8 hex chars. */
function fnv1a(s: string, basis: number): string {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 64 bits (two independent FNV-1a passes): collision-free in practice for the handful of accounts on one phone. */
export function scopeKeyId(scope: string): string {
  return `${fnv1a(scope, 0x811c9dc5)}${fnv1a(scope, 0x050c5d1f)}`;
}

/** `<prefix><group>.<part>` → its group (an account's scope or its hash) and part; null for other keys. */
export function legacyGroupOf(key: string, prefix: string): { group: string; part: string } | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { group: rest.slice(0, dot), part: rest.slice(dot + 1) };
}
