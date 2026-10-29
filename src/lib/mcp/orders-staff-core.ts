// Pure core for the connector's group-buy-orders and staff tools
// (npm run test:mcp-orders-staff).
//
//   • list_group_buy_orders reads the SAME folders the store admin's Orders
//     screen opens on (order-folders.ts) — this module only reshapes them for a
//     chat: no row ids, one compact record per round.
//   • manage_store_staff runs the website's own staff actions as the owner.
//     The website SILENTLY drops an unknown permission key (sanitizePermissions);
//     a remote caller can't see that, so here an unknown key refuses the call,
//     naming the valid ones — same fail-loud rule as update_whitelabel_branding.
//
// No Prisma, no server-only: the tool shell does the I/O.

import type { OrderFolder, OrderFolders } from "@/lib/storefront/order-folders";
import { STAFF_MODULES } from "@/storefront/admin/staff-permissions";

export type Row = Record<string, unknown>;

export type FolderSummary = Omit<OrderFolder, "orderIds">;

/** One round, minus the row ids — those mean nothing in a chat. */
export function summarizeFolder(f: OrderFolder): FolderSummary {
  const { orderIds: _ids, ...rest } = f;
  return rest;
}

export function summarizeFolders(folders: OrderFolders): Record<keyof OrderFolders, FolderSummary[]> {
  return {
    live: folders.live.map(summarizeFolder),
    upcoming: folders.upcoming.map(summarizeFolder),
    recent: folders.recent.map(summarizeFolder),
    archived: folders.archived.map(summarizeFolder),
  };
}

// ── Staff ────────────────────────────────────────────────────────────────

export const STAFF_OPERATIONS = ["list", "create", "update", "suspend", "activate"] as const;
export type StaffOperation = (typeof STAFF_OPERATIONS)[number];

const MODULE_KEYS = new Set(STAFF_MODULES.map((m) => m.key));
const LABEL_TO_KEY = new Map(STAFF_MODULES.map((m) => [m.label.toLowerCase(), m.key]));

/** Every module a staff account can be granted, for the tool description. */
export const STAFF_MODULE_HELP = STAFF_MODULES.map((m) => `${m.key} (${m.label})`).join(", ");

/** A module key from its key or label, forgiving case and a missing/extra plural "s". */
function moduleKeyFor(raw: string): string | undefined {
  const lower = raw.trim().toLowerCase();
  if (!lower) return undefined;
  for (const v of [lower, `${lower}s`, lower.replace(/s$/, "")]) {
    if (MODULE_KEYS.has(v)) return v;
    const byLabel = LABEL_TO_KEY.get(v);
    if (byLabel) return byLabel;
  }
  return undefined;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Resolve permissions given as module keys or their labels ("Orders",
 * "group buys"). "all" grants every module. Any unknown entry refuses the
 * whole list rather than quietly giving the staff member less than asked.
 */
export function resolveStaffPermissions(raw: unknown): Parsed<string[]> {
  if (raw === "all") return { ok: true, value: [...MODULE_KEYS] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: `permissions must be a list of modules, or "all". Valid: ${STAFF_MODULE_HELP}.` };
  }
  const out: string[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    const key = moduleKeyFor(typeof item === "string" ? item : "");
    if (!key) unknown.push(String(item));
    else if (!out.includes(key)) out.push(key);
  }
  if (unknown.length) return { ok: false, error: `Unknown permission(s): ${unknown.join(", ")}. Valid: ${STAFF_MODULE_HELP}.` };
  return { ok: true, value: out };
}

export type StaffPayload = {
  fullName: string;
  email: string;
  username: string;
  status: "active" | "suspended";
  permissions: string[];
  password: string;
  confirmPassword: string;
};

export type StaffCurrent = { fullName: string; email: string; username: string; status: string; permissions: string[] };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Build the website action's payload. For an update, unspecified fields keep
 * the staff member's current values (the website action saves the whole row,
 * so a partial patch must be merged first), and a blank password keeps theirs.
 */
export function buildStaffPayload(args: Row, current: StaffCurrent | null, password: string): Parsed<StaffPayload> {
  let permissions = current?.permissions ?? [];
  if (args.permissions !== undefined) {
    const resolved = resolveStaffPermissions(args.permissions);
    if (!resolved.ok) return resolved;
    permissions = resolved.value;
  }
  if (!current && permissions.length === 0) {
    return { ok: false, error: `Give the new staff account at least one permission. Valid: ${STAFF_MODULE_HELP}.` };
  }
  const email = str(args.email) || current?.email || "";
  return {
    ok: true,
    value: {
      fullName: str(args.fullName) || current?.fullName || "",
      email,
      username: str(args.username) || current?.username || email.split("@")[0] || "",
      status: current?.status === "suspended" ? "suspended" : "active",
      permissions,
      password,
      confirmPassword: password,
    },
  };
}
