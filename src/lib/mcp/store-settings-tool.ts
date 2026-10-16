// MCP tools that make a store able to SELL: read its settings, set the owner's
// sign-in, categories (with images), checkout (payment methods + QR images,
// couriers, shipping, contact channels, currency), and access (open/closed
// switch + visitor access code).
//
// Each write runs the website's own store-admin action as the store owner
// (./owner-scope), so validation and plan locks are exactly the admin panel's.
// The few settings the website saves only from the OPERATOR console (contact
// channels, proof-of-payment, the owner credential) are written here directly,
// with the same validators those operator actions use. The connector holds the
// operator's token, so it is entitled to both halves.
//
// Pure prep (ids, courier-name resolution, merges, the redacted read) is in
// ./store-settings-core and pinned by npm run test:mcp-store-settings.

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password-hash";
import { validateStoreAdminCredentialInput } from "@/lib/auth/store-admin-credential";
import { revalidateTenant } from "@/lib/tenant/revalidate";
import { normalizeStoreStatus } from "@/lib/storefront/store-status";
import {
  saveCategoriesAction,
  saveCouriersAction,
  saveCurrencyAction,
  savePaymentMethodsAction,
  saveShippingLocationsAction,
  saveStoreStatusAction,
} from "@/actions/storefront-admin";
import { rotateAccessCodeAction, setGateSettingsAction } from "@/actions/storefront-gate";
import { MCP_ASSET_SCHEMA } from "@/lib/mcp/tenant-media";
import {
  patchContactChannels,
  prepareCategories,
  prepareCouriers,
  preparePaymentMethods,
  prepareShippingLocations,
  projectStoreSettings,
  removalError,
  type Row,
} from "@/lib/mcp/store-settings-core";
import {
  TENANT_SCHEMA,
  TOKEN_SCHEMA,
  fail,
  ok,
  ownerStep,
  plainObject,
  readConfig,
  resolveTenant,
  rowList,
  stepsResult,
  uploadRowImages,
  withoutKey,
  writeConfigPatch,
  type StepResult,
  type ToolResult,
} from "@/lib/mcp/owner-scope";

const WRITE_ANNOTATIONS = { destructiveHint: false, idempotentHint: true, openWorldHint: true };

const LIST_NOTE =
  "Lists are saved WHOLE: send the complete list you want the store to end up with (call get_store_settings first and edit its rows). A row sent without an id keeps the id of the existing row with the same name.";

// ── get_store_settings ───────────────────────────────────────────────────

export const GET_STORE_SETTINGS_TOOL = {
  name: "get_store_settings",
  title: "Get Store Settings",
  description:
    "Read-only. Returns an existing store's selling setup — categories, payment methods, couriers, shipping locations, contact channels, promo codes, FAQ, lab reports, reviews, notice popup, store open/closed, access gate, footer, hero image and whether an admin sign-in is set. Passwords and codes are never returned, only whether they are set. Call this before editing any list.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { adminToken: TOKEN_SCHEMA, tenantSlug: TENANT_SCHEMA },
    required: ["tenantSlug"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export async function callGetStoreSettings(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const [config, row] = await Promise.all([
    readConfig(tenant.id),
    prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { storeAdminEmail: true, storeAdminPasswordHash: true, accessCodeHash: true },
    }),
  ]);
  return ok({
    tenant: { slug: tenant.slug, name: tenant.name },
    settings: projectStoreSettings(config, {
      storeAdminEmail: row?.storeAdminEmail ?? null,
      hasPassword: Boolean(row?.storeAdminPasswordHash),
      hasAccessCode: Boolean(row?.accessCodeHash),
    }),
  });
}

// ── set_store_admin_login ────────────────────────────────────────────────

export const SET_STORE_ADMIN_LOGIN_TOOL = {
  name: "set_store_admin_login",
  title: "Set Store Admin Sign-in",
  description:
    "Set the email + password the store owner uses to sign in to the store's #admin. Send password to choose one, or generatePassword:true to have one generated and returned ONCE (tell the operator to pass it to the owner privately, and that it now sits in this chat transcript — the owner should change it from their admin). A blank password keeps the current one (email-only change), but only if one is already set. Replaces any previous password.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      email: { type: "string", description: "Owner sign-in email." },
      password: { type: "string", description: "At least 6 characters." },
      generatePassword: { type: "boolean", description: "Generate a strong password and return it." },
    },
    required: ["tenantSlug", "email"],
  },
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
};

const GENERATED_PASSWORD_BYTES = 9; // 12 base64url chars

export async function callSetStoreAdminLogin(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  if (args.generatePassword === true && typeof args.password === "string" && args.password.trim()) {
    return fail("Send either password or generatePassword, not both.");
  }
  const generated = args.generatePassword === true ? randomBytes(GENERATED_PASSWORD_BYTES).toString("base64url") : "";

  const row = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { storeAdminPasswordHash: true } });
  const checked = validateStoreAdminCredentialInput({
    email: String(args.email ?? ""),
    password: generated || String(args.password ?? ""),
    hasExistingPassword: Boolean(row?.storeAdminPasswordHash),
  });
  if (!checked.ok) return fail(checked.error);

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      storeAdminEmail: checked.email,
      ...(checked.password ? { storeAdminPasswordHash: hashPassword(checked.password) } : {}),
    },
  });
  revalidateTenant(tenant.id, tenant.slug);

  return ok({
    tenant: { slug: tenant.slug, name: tenant.name },
    email: checked.email,
    passwordChanged: Boolean(checked.password),
    ...(generated ? { generatedPassword: generated, note: "Shown once. It cannot be read back later." } : {}),
    signIn: "Open the storefront and go to #admin.",
  });
}

// ── manage_store_categories ──────────────────────────────────────────────

export const MANAGE_CATEGORIES_TOOL = {
  name: "manage_store_categories",
  title: "Manage Store Categories",
  description: `Replace a store's product categories, optionally with a tile image per category (shown by the showcase/boutique home layouts). ${LIST_NOTE} Products store the category ID, so keep existing ids when renaming. Use the returned ids as the category when adding products.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      confirmRemove: { type: "boolean", description: "Required to save a list that drops existing rows." },
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            image: { type: "string", description: "Already-hosted http(s) image URL, or \"\" for none." },
            imageAsset: { ...MCP_ASSET_SCHEMA, description: "Image to upload instead of image." },
          },
          required: ["label"],
        },
      },
    },
    required: ["tenantSlug", "categories"],
  },
  annotations: WRITE_ANNOTATIONS,
};

export async function callManageCategories(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const existing = rowList((await readConfig(tenant.id)).categories);

  const dryInput = Array.isArray(args.categories) ? withoutKey(rowList(args.categories), "imageAsset") : args.categories;
  const dry = prepareCategories(dryInput, existing);
  if (!dry.ok) return fail(dry.error);
  const dryRemoval = removalError("category", dry.rows, existing, "label", args.confirmRemove === true);
  if (dryRemoval) return fail(`Nothing saved. ${dryRemoval} Products in a removed category lose their filter.`);

  let rows: Row[];
  try {
    rows = await uploadRowImages(tenant, rowList(args.categories), "imageAsset", "image", "category", "label");
  } catch (e) {
    return fail(`Category image upload failed — nothing saved. ${e instanceof Error ? e.message : e}`);
  }
  const prepared = prepareCategories(rows, existing);
  if (!prepared.ok) return fail(prepared.error);
  const removal = removalError("category", prepared.rows, existing, "label", args.confirmRemove === true);
  if (removal) return fail(`Nothing saved. ${removal} Products in a removed category lose their filter.`);

  const step = await ownerStep(tenant, "categories", () => saveCategoriesAction(prepared.rows));
  return stepsResult(tenant, [step], { categories: prepared.rows });
}

// ── configure_store_checkout ─────────────────────────────────────────────

const PAYMENT_METHOD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string", description: "e.g. GCash, BDO, Maya." },
    account: { type: "string", description: "Account name." },
    number: { type: "string", description: "Account / mobile number." },
    qrImage: { type: "string", description: "Already-hosted QR image URL." },
    qrImageAsset: { ...MCP_ASSET_SCHEMA, description: "QR image to upload instead of qrImage." },
    active: { type: "boolean" },
    order: { type: "number" },
    qrph: { type: "boolean", description: "Tag as a QR PH account (adds the processing fee when the store has that feature)." },
  },
  required: ["name"],
};

const COURIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string", description: "e.g. J&T Express, LBC, Lalamove." },
    trackingUrl: { type: "string" },
    bookingUrl: { type: "string", description: "http(s) booking form shown at checkout (needs the feature grant)." },
    active: { type: "boolean" },
    noLocation: { type: "boolean", description: "True for COD riders (Lalamove, Maxim): no shipping location or fee." },
    note: { type: "string", description: "Short note shown at checkout when this courier is picked, e.g. coverage area or pick-up point (max 300 chars)." },
  },
  required: ["name"],
};

const SHIPPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string", description: "e.g. Metro Manila, Luzon, Visayas." },
    code: { type: "string" },
    courier: { type: "string", description: "Courier name or id this fee belongs to." },
    price: { type: "number", description: "Shipping fee. Omit for a label-only location." },
    active: { type: "boolean" },
  },
  required: ["name"],
};

export const CONFIGURE_CHECKOUT_TOOL = {
  name: "configure_store_checkout",
  title: "Configure Store Checkout",
  description: `Set up how an existing store takes orders: payment methods (with QR images), couriers, shipping locations + fees, the order contact channels (WhatsApp/Telegram/Messenger/Viber/Gmail/Instagram), checkout copy, whether proof of payment is required, and the currency. Send only the sections to change. ${LIST_NOTE} contactChannels is a PATCH: only the channels named change.`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      confirmRemove: { type: "boolean", description: "Required to save a list that drops existing rows." },
      paymentMethods: { type: "array", items: PAYMENT_METHOD_SCHEMA },
      couriers: { type: "array", items: COURIER_SCHEMA },
      shippingLocations: { type: "array", items: SHIPPING_SCHEMA },
      contactChannels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["whatsapp", "telegram", "messenger", "viber", "gmail", "instagram"] },
            destination: { type: "string", description: "Phone in international digits, username, page name, or email." },
            enabled: { type: "boolean" },
          },
          required: ["type"],
        },
      },
      checkoutTitle: { type: "string" },
      checkoutNote: { type: "string" },
      requireProofOfPayment: { type: "boolean" },
      currency: { type: "string", description: "Symbol or ISO code, e.g. PHP, ₱, USD. Prices are not converted." },
    },
    required: ["tenantSlug"],
  },
  annotations: WRITE_ANNOTATIONS,
};

type CheckoutPlan = {
  paymentMethods?: Row[];
  couriers?: Row[];
  shippingLocations?: Row[];
  configPatch: Row;
};

/** Validate every section before anything is written or uploaded. */
function planCheckout(args: Row, config: Row): { ok: true; plan: CheckoutPlan } | { ok: false; error: string } {
  const plan: CheckoutPlan = { configPatch: {} };
  const confirm = args.confirmRemove === true;

  if (args.paymentMethods !== undefined) {
    const rows = Array.isArray(args.paymentMethods) ? withoutKey(rowList(args.paymentMethods), "qrImageAsset") : args.paymentMethods;
    const p = preparePaymentMethods(rows, rowList(config.paymentMethods));
    if (!p.ok) return p;
    plan.paymentMethods = p.rows;
  }
  if (args.couriers !== undefined) {
    const p = prepareCouriers(args.couriers, rowList(config.couriers));
    if (!p.ok) return p;
    const removal = removalError("courier", p.rows, rowList(config.couriers), "name", confirm);
    if (removal) return { ok: false, error: removal };
    plan.couriers = p.rows;
  }
  if (args.shippingLocations !== undefined) {
    const couriers = plan.couriers ?? rowList(config.couriers);
    const p = prepareShippingLocations(args.shippingLocations, couriers, rowList(config.shippingLocations));
    if (!p.ok) return p;
    const removal = removalError("shipping location", p.rows, rowList(config.shippingLocations), "name", confirm);
    if (removal) return { ok: false, error: removal };
    plan.shippingLocations = p.rows;
  }
  if (args.contactChannels !== undefined) {
    const p = patchContactChannels(config.contactChannels, args.contactChannels);
    if (!p.ok) return p;
    plan.configPatch.contactChannels = p.channels;
  }
  if (typeof args.checkoutTitle === "string") plan.configPatch.checkoutTitle = args.checkoutTitle.trim().slice(0, 200);
  if (typeof args.checkoutNote === "string") plan.configPatch.checkoutNote = args.checkoutNote.trim().slice(0, 1000);
  if (typeof args.requireProofOfPayment === "boolean") plan.configPatch.requireProofOfPayment = args.requireProofOfPayment;
  return { ok: true, plan };
}

async function uploadPaymentQrs(tenant: Parameters<typeof uploadRowImages>[0], prepared: Row[], inputs: Row[]): Promise<Row[]> {
  // Prep kept the input order, so prepared row i came from input i.
  const withAssets = prepared.map((r, i) => ({ ...r, qrImageAsset: inputs[i]?.qrImageAsset }));
  return uploadRowImages(tenant, withAssets, "qrImageAsset", "qrImage", "payment", "name");
}

export async function callConfigureCheckout(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;

  const planned = planCheckout(args, await readConfig(tenant.id));
  if (!planned.ok) return fail(`Nothing saved. ${planned.error}`);
  const { plan } = planned;

  let paymentMethods: Row[] | undefined;
  if (plan.paymentMethods) {
    try {
      paymentMethods = await uploadPaymentQrs(tenant, plan.paymentMethods, rowList(args.paymentMethods));
    } catch (e) {
      return fail(`QR image upload failed — nothing saved. ${e instanceof Error ? e.message : e}`);
    }
  }

  const steps: StepResult[] = [];
  if (paymentMethods) {
    const methods = paymentMethods;
    steps.push(await ownerStep(tenant, "paymentMethods", () => savePaymentMethodsAction(methods)));
  }
  let couriersFailed = false;
  if (plan.couriers) {
    const couriers = plan.couriers;
    const step = await ownerStep(tenant, "couriers", () => saveCouriersAction(couriers));
    couriersFailed = !step.ok;
    steps.push(step);
  }
  if (plan.shippingLocations && couriersFailed) {
    steps.push({ step: "shippingLocations", ok: false, error: "Skipped: the couriers they belong to were not saved." });
  } else if (plan.shippingLocations) {
    const locations = plan.shippingLocations;
    steps.push(await ownerStep(tenant, "shippingLocations", () => saveShippingLocationsAction(locations)));
  }
  if (typeof args.currency === "string" && args.currency.trim()) {
    const currency = args.currency.trim();
    steps.push(await ownerStep(tenant, "currency", () => saveCurrencyAction(currency)));
  }
  const patchKeys = Object.keys(plan.configPatch);
  if (patchKeys.length > 0) {
    try {
      await writeConfigPatch(tenant, (current) => ({ ...current, ...plan.configPatch }));
      steps.push({ step: patchKeys.join(", "), ok: true });
    } catch (e) {
      steps.push({ step: patchKeys.join(", "), ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return stepsResult(tenant, steps);
}

// ── set_store_access ─────────────────────────────────────────────────────

export const SET_STORE_ACCESS_TOOL = {
  name: "set_store_access",
  title: "Set Store Open/Closed and Access Code",
  description:
    "Open or close an existing store (closed = browsable but every buy button reads Closed), and manage the visitor access-code gate. Setting accessGate.code saves a new code AND turns the gate on, signing out every current visitor. The gate needs the access-code feature (turn it on with set_whitelabel_features first).",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      storeStatus: {
        type: "object",
        additionalProperties: false,
        properties: {
          open: { type: "boolean" },
          headline: { type: "string", description: "Closed-notice headline; blank = automatic." },
          message: { type: "string", description: "Note to shoppers, e.g. Back Monday 9am." },
        },
      },
      accessGate: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string", description: "New visitor code, at least 6 characters." },
          enabled: { type: "boolean" },
          heading: { type: "string" },
        },
      },
    },
    required: ["tenantSlug"],
  },
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
};

export async function callSetStoreAccess(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const steps: StepResult[] = [];

  const status = plainObject(args.storeStatus);
  if (status) {
    const stored = plainObject((await readConfig(tenant.id)).storeStatus) ?? {};
    const merged = normalizeStoreStatus({ ...stored, ...status });
    steps.push(await ownerStep(tenant, "storeStatus", () => saveStoreStatusAction(merged)));
  }

  const gate = plainObject(args.accessGate);
  if (gate) {
    const code = typeof gate.code === "string" ? gate.code.trim() : "";
    const rotation = code ? await ownerStep(tenant, "accessCode", () => rotateAccessCodeAction(code)) : null;
    if (rotation) steps.push(rotation);
    if (rotation && !rotation.ok) {
      steps.push({ step: "accessGate", ok: false, error: "Skipped: the access code was not saved." });
    } else if (gate.enabled !== undefined || gate.heading !== undefined) {
      const stored = plainObject((await readConfig(tenant.id)).accessGate) ?? {};
      const next = {
        enabled: gate.enabled !== undefined ? gate.enabled === true : stored.enabled === true,
        heading: typeof gate.heading === "string" ? gate.heading : String(stored.heading ?? ""),
      };
      steps.push(await ownerStep(tenant, "accessGate", () => setGateSettingsAction(next)));
    }
  }
  return stepsResult(tenant, steps);
}
