import "server-only";

// Two connector tools that run the website's own store-admin actions as the
// store OWNER (owner-scope.ts), so permission, entitlement and validation rules
// stay in one place:
//
//   list_group_buy_orders — read-only. The folders the Orders screen opens on,
//     or one round's orders + the numbers its two Excel reports carry.
//   manage_store_staff — the store's extra admin sign-ins (Staff Accounts),
//     with per-module permissions. No delete: suspend instead.
//
// Pure reshaping/validation lives in orders-staff-core.ts.

import { randomBytes } from "node:crypto";

import { getGroupBuyDashboardAction, listOrderFoldersAction } from "@/actions/group-buys";
import { createStaffAction, listStaffAction, setStaffStatusAction, updateStaffAction } from "@/actions/storefront-staff";
import { findOrderFolder } from "@/lib/storefront/order-folders";
import {
  STAFF_MODULE_HELP,
  STAFF_OPERATIONS,
  buildStaffPayload,
  summarizeFolder,
  summarizeFolders,
  type Row,
} from "@/lib/mcp/orders-staff-core";
import { TENANT_SCHEMA, TOKEN_SCHEMA, fail, ok, resolveTenant, runAsStoreOwner, type ToolResult } from "@/lib/mcp/owner-scope";

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_ANNOTATIONS = { destructiveHint: false, idempotentHint: false, openWorldHint: true };

// ── list_group_buy_orders ────────────────────────────────────────────────

export const LIST_GROUP_BUY_ORDERS_TOOL = {
  name: "list_group_buy_orders",
  title: "List Group Buy Orders & Reports",
  description:
    "Read-only. A group-buy store's orders filed per round — the same view as store admin → Orders. Without groupBuy: every round grouped live / upcoming / recent / archived with orders, members, new + unpaid counts, gross, collected and outstanding. With groupBuy (round name, batch label or id): that round's orders, per-customer totals (paid / balance) and the supplier 'products to order' list — the same numbers as the round's two Excel reports. Customer contact details and addresses are left out unless includeCustomerDetails is true; only ask for them when the operator needs them. The Excel files themselves download from store admin → Orders → the round → Reports.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      groupBuy: { type: "string", description: "Round name, batch label or id. Omit to list every round." },
      includeCustomerDetails: { type: "boolean", description: "Include buyer email/phone/address. Default false." },
    },
    required: ["tenantSlug"],
  },
  annotations: READ_ANNOTATIONS,
};

const MAX_ORDER_LINES = 500;

export async function callListGroupBuyOrders(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const store = { slug: tenant.slug, name: tenant.name };

  const res = await runAsStoreOwner(tenant, () => listOrderFoldersAction());
  if ("error" in res) return fail(res.error);
  if (!res.enabled) {
    return fail(`${tenant.name} has no group buys yet (or the Group Buy module is off). Check list_whitelabel_features.`);
  }

  const query = typeof args.groupBuy === "string" ? args.groupBuy : "";
  if (!query.trim()) return ok({ tenant: store, rounds: summarizeFolders(res.folders) });

  const matches = findOrderFolder(res.folders, query);
  if (matches.length === 0) return fail(`No group buy matches "${query}". Call without groupBuy to list the rounds.`);
  if (matches.length > 1) {
    const names = matches.map((m) => `${m.name} (${m.batchNumber})`).join("; ");
    return fail(`"${query}" matches ${matches.length} rounds: ${names}. Ask the operator which one.`);
  }
  const folder = matches[0];
  const dash = await runAsStoreOwner(tenant, () => getGroupBuyDashboardAction(folder.id));
  if ("error" in dash) return fail(dash.error);

  const details = args.includeCustomerDetails === true;
  const orders = dash.orderRows.slice(0, MAX_ORDER_LINES).map((r) => ({
    orderNumber: r.orderNumber,
    customer: r.customer,
    ...(details ? { contact: r.contact, address: r.address } : {}),
    product: r.product,
    vials: r.vials,
    price: r.price,
    orderDate: r.orderDate,
    paymentStatus: r.paymentStatus,
    orderStatus: r.orderStatus,
    counted: r.counted,
  }));
  const customers = dash.prep.memberOrders.map((m) => ({
    name: m.name,
    ...(details ? { email: m.email, contact: m.contact, address: m.address } : {}),
    checkouts: m.checkouts.length,
    products: m.products,
    total: m.total,
    paid: m.paid,
    balance: m.balance,
  }));

  return ok({
    tenant: store,
    groupBuy: summarizeFolder(folder),
    supplierReport: {
      productsToOrder: dash.analytics.product.productsToOrder,
      totalVials: dash.analytics.product.totalVials,
    },
    customers,
    orders,
    ...(dash.orderRows.length > MAX_ORDER_LINES
      ? { truncated: `Showing ${MAX_ORDER_LINES} of ${dash.orderRows.length} order lines.` }
      : {}),
    downloads: "Excel: store admin → Orders → this round → Reports (supplier order sheet + customer & payments list).",
  });
}

// ── manage_store_staff ───────────────────────────────────────────────────

export const MANAGE_STORE_STAFF_TOOL = {
  name: "manage_store_staff",
  title: "Manage Store Staff Accounts",
  description: `Extra admin sign-ins for a store (Staff Accounts), each limited to the modules you grant. The OWNER's own sign-in is set_store_admin_login, not this. operation: list | create | update | suspend | activate (no delete — suspend locks the account and keeps its history). Target an existing account with staff = its email, username or id. create needs email + permissions, and a password or generatePassword:true (returned ONCE — tell the operator to pass it on privately; it now sits in this chat). update changes only the fields you send; permissions you send REPLACE the old list. Permissions are module keys or labels, or "all": ${STAFF_MODULE_HELP}. Staff Accounts must be enabled for the store (list_whitelabel_features / set_whitelabel_features). Staff sign in at the store's #admin with their email + password.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      operation: { type: "string", enum: [...STAFF_OPERATIONS] },
      staff: { type: "string", description: "update/suspend/activate: the account's email, username or id." },
      fullName: { type: "string" },
      email: { type: "string", description: "Sign-in email." },
      username: { type: "string", description: "Optional; defaults to the part of the email before @." },
      permissions: {
        description: 'Module keys or labels, or "all".',
        anyOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }],
      },
      password: { type: "string", description: "At least 6 characters." },
      generatePassword: { type: "boolean", description: "Generate a strong password and return it once." },
    },
    required: ["tenantSlug", "operation"],
  },
  annotations: WRITE_ANNOTATIONS,
};

const GENERATED_PASSWORD_BYTES = 9; // 12 base64url chars

type StaffItem = Extract<Awaited<ReturnType<typeof listStaffAction>>, { ok: true }>["items"][number];
type PasswordPick = { ok: true; password: string; generated: boolean } | { ok: false; error: string };

function pickPassword(args: Row): PasswordPick {
  const typed = typeof args.password === "string" ? args.password.trim() : "";
  if (args.generatePassword === true && typed) return { ok: false, error: "Send either password or generatePassword, not both." };
  if (args.generatePassword === true) {
    return { ok: true, password: randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url"), generated: true };
  }
  return { ok: true, password: typed, generated: false };
}

function findStaff(items: StaffItem[], ref: unknown): StaffItem[] {
  const q = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  if (!q) return [];
  return items.filter((s) => s.id.toLowerCase() === q || s.email.toLowerCase() === q || s.username.toLowerCase() === q);
}

function publicStaff(s: StaffItem) {
  return { id: s.id, fullName: s.fullName, email: s.email, username: s.username, status: s.status, permissions: s.permissions };
}

function passwordNote(pw: PasswordPick): Row {
  return pw.ok && pw.generated
    ? { password: pw.password, note: "Shown once. Pass it to the staff member privately; they sign in at the store's #admin." }
    : {};
}

export async function callManageStoreStaff(args: Row): Promise<ToolResult> {
  const op = args.operation;
  if (typeof op !== "string" || !(STAFF_OPERATIONS as readonly string[]).includes(op)) {
    return fail(`operation must be one of: ${STAFF_OPERATIONS.join(", ")}.`);
  }
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const store = { slug: tenant.slug, name: tenant.name };

  const listed = await runAsStoreOwner(tenant, () => listStaffAction());
  if ("error" in listed) return fail(listed.error);
  if (op === "list") return ok({ tenant: store, staff: listed.items.map(publicStaff) });

  const pw = pickPassword(args);
  if (!pw.ok) return fail(pw.error);

  if (op === "create") {
    if (!pw.password) return fail("A new staff account needs a password, or generatePassword:true.");
    const payload = buildStaffPayload(args, null, pw.password);
    if (!payload.ok) return fail(payload.error);
    const res = await runAsStoreOwner(tenant, () => createStaffAction(payload.value));
    if ("error" in res) return fail(res.error);
    const { email, username, permissions } = payload.value;
    return ok({ tenant: store, created: { email, username, permissions }, ...passwordNote(pw) });
  }

  const matches = findStaff(listed.items, args.staff);
  if (matches.length !== 1) {
    return fail(
      matches.length
        ? "That matches more than one staff account — use the id."
        : `No staff account matches "${String(args.staff ?? "")}". Call with operation:list.`,
    );
  }
  const target = matches[0];

  if (op === "suspend" || op === "activate") {
    const status = op === "suspend" ? "suspended" : "active";
    const res = await runAsStoreOwner(tenant, () => setStaffStatusAction(target.id, status));
    if ("error" in res) return fail(res.error);
    return ok({ tenant: store, staff: target.email, status });
  }

  const payload = buildStaffPayload(args, target, pw.password);
  if (!payload.ok) return fail(payload.error);
  const res = await runAsStoreOwner(tenant, () => updateStaffAction(target.id, payload.value));
  if ("error" in res) return fail(res.error);
  const { email, username, permissions } = payload.value;
  return ok({ tenant: store, updated: { email, username, permissions }, ...passwordNote(pw) });
}
