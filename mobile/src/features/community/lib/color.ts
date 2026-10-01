// Colour math for the chat theme: the store's brand colour mixed toward white
// for soft fills, plus the inspiration's stable pastel avatar hues.

type Rgb = { r: number; g: number; b: number };

/** "#abc", "#aabbcc" (or "#aabbccdd") → rgb; null when unparseable. */
export function parseHex(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Blend `hex` toward `toward` by `amount` (0 = hex, 1 = toward). */
export function mix(hex: string, toward: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  if (!a || !b) return hex;
  const t = Math.min(1, Math.max(0, amount));
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

/** `hex` at the given opacity, as rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${c.r},${c.g},${c.b},${Math.min(1, Math.max(0, alpha))})`;
}

/** Stable pastel avatar colour from a hue the server assigned once. */
export function avatarColors(hue: number): { bg: string; fg: string } {
  const h = ((hue % 360) + 360) % 360;
  return { bg: `hsl(${h}, 62%, 86%)`, fg: `hsl(${h}, 48%, 30%)` };
}

/** A saturated name colour for group-chat sender labels (Telegram style). */
export function senderColor(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsl(${h}, 55%, 38%)`;
}

/** A deterministic hue from any string, for channels and topics. */
export function hueFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
