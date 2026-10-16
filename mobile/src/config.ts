/**
 * App configuration. Public values only — this app holds no server secrets.
 * EXPO_PUBLIC_* variables are inlined at build time (see mobile/.env.example).
 */

/** The app's name, everywhere a person reads it (sign-in, About line, help). */
export const APP_NAME = "PepWorld";

/** Where the Pepweb platform (and its /api/mobile/v1 API) is served. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://app.pepweb.store").replace(/\/+$/, "");

/** The platform root — shown as the hint in the "Store address" field. */
export const ROOT_DOMAIN = process.env.EXPO_PUBLIC_ROOT_DOMAIN ?? "pepweb.store";

/** Where owners get help with their store password (no self-service reset exists). */
export const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL ?? "https://pepweb.store";

/** Where reports of objectionable chat content go (reviewed within 24 hours). */
export const SAFETY_EMAIL = process.env.EXPO_PUBLIC_SAFETY_EMAIL ?? "hello@jonina.store";

/** The public legal pages, linked from the welcome screen's fine print. */
export const TERMS_URL = `https://${ROOT_DOMAIN}/terms`;
export const PRIVACY_URL = `https://${ROOT_DOMAIN}/privacy`;

/**
 * Signed-out phones linked to a store used to browse its shop as a guest.
 * Off: signed out, the app is the welcome screen, sign-in and create-account
 * only — every feature (shop, cart, community) starts after sign-in.
 */
export const GUEST_BROWSING = false;
