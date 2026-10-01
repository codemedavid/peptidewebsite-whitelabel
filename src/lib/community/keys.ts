// Participant identity for the community (docs/mobile-admin/COMMUNITY.md).
// Pure: no DB, no Next — covered by npm run test:community-core.
//
//   `store`     — the store team (owner + staff with the `community` module
//                 post as ONE shared voice; each message still records who
//                 wrote it in `authorKey`)
//   `c:<id>`    — a storefront customer (StorefrontCustomer.id)

export const STORE_KEY = "store";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ParticipantRef = { kind: "store" } | { kind: "customer"; id: string };

export function customerKey(customerId: string): string {
  return `c:${customerId}`;
}

export function parseParticipantKey(raw: unknown): ParticipantRef | null {
  if (raw === STORE_KEY) return { kind: "store" };
  if (typeof raw !== "string" || !raw.startsWith("c:")) return null;
  const id = raw.slice(2);
  return ID_RE.test(id) ? { kind: "customer", id } : null;
}

/** DM rows store the pair ordered (lo < hi) so one pair is one unique row. */
export function dmPair(a: string, b: string): { lowKey: string; highKey: string } | null {
  if (a === b) return null;
  return a < b ? { lowKey: a, highKey: b } : { lowKey: b, highKey: a };
}

export function dmPeerOf(conv: { lowKey: string; highKey: string }, me: string): string | null {
  if (conv.lowKey === me) return conv.highKey;
  if (conv.highKey === me) return conv.lowKey;
  return null;
}

/** Stable 0–359 hue (FNV-1a) for a pastel avatar. */
export function avatarHue(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/** Which person on the store team wrote a `store` message. */
export function authorKeyFor(actor: { kind: "owner" } | { kind: "staff"; id: string; permissions?: string[] }): string {
  return actor.kind === "owner" ? "owner" : `s:${actor.id}`;
}
