/**
 * Shared constants for the visitor access-code gate. Imported by BOTH the Node
 * paths (storefront-gate.ts, the verify action) and the Edge path (gate-roll.ts /
 * middleware), so this file MUST stay dependency-free — no node:crypto, no
 * next/*, no "server-only".
 */

export const GATE_COOKIE_NAME = "tenant.sid";

/** Idle / rolling timeout: a session expires this long after the LAST request. */
export const GATE_TTL_SECONDS = 15 * 60; // 15 minutes

/**
 * Absolute session lifetime cap, measured from first unlock (`iat`). Rolling can
 * extend a session indefinitely on activity; this bounds the total so a cookie
 * can't be re-stamped forever. After the cap the visitor must re-enter the code.
 */
export const GATE_MAX_SESSION_SECONDS = 12 * 60 * 60; // 12 hours
