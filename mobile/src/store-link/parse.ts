/**
 * A link (or text) that names a store → the identifier the server resolves.
 *
 *   pepwebadmin://store/hpglow              → "hpglow"   (the /app page's button)
 *   /store/hpglow                           → "hpglow"   (the same, as expo-router hands it over)
 *   https://hpglow.pepweb.store/app         → "hpglow.pepweb.store"
 *   https://shop.example.com/app?x=1        → "shop.example.com"
 *   hpglow  /  hpglow.pepweb.store          → as typed (the "Add your store" field)
 *
 * The app never trusts the result: GET /stores/:store resolves it on the
 * server, which is also what later scopes the sign-in. Pure — covered by
 * npm run test:mobile-core.
 */

const SCHEME = "pepwebadmin";
const MAX = 253;

/** From a deep link / URL. null when it isn't a store link. */
export function storeFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw || raw.length > MAX + 40) return null;

  const deep = new RegExp(`^(?:${SCHEME}:\\/\\/\\/?|\\/)store\\/([^/?#]+)`, "i").exec(raw);
  if (deep) return clean(safeDecode(deep[1]));

  const web = /^https?:\/\/([^/?#]+)\/app\/?(?:[?#].*)?$/i.exec(raw);
  if (web) return clean(web[1]);
  return null;
}

/** From what someone typed or pasted into "Add your store". */
export function storeFromInput(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  const fromLink = storeFromUrl(raw);
  if (fromLink) return fromLink;
  const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return clean(host);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

function clean(s: string): string | null {
  const v = s.trim().toLowerCase().replace(/\.$/, "");
  if (!v || v.length > MAX || !/^[a-z0-9.-]+(:\d{1,5})?$/.test(v)) return null;
  return v;
}
