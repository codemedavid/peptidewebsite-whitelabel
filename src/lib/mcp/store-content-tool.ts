// MCP tools for a store's CONTENT and everything else in its admin:
//
//   manage_store_content   — FAQ, lab reports (COA), reviews, promo codes, the
//                            notice popup (incl. the operator grant), the
//                            track-order delivery note, and the footer.
//   upload_store_image     — host any image in the tenant's ImageKit folder and
//                            get its URL back, for fields that take a URL.
//   run_store_admin_action — the remaining store-admin settings (hero copy,
//                            banner, checkout rules, card design, protocols,
//                            group buys …) through the website's own actions,
//                            limited to STORE_ACTION_ALLOWLIST: config only,
//                            never customer PII, never deletes, never staff.
//
// Same contract as ./store-settings-tool: validate everything first, upload,
// then run the website actions as the store owner (./owner-scope).

import { normalizeNoticeModal } from "@/lib/storefront/notice-modal";
import {
  saveCoaReportsAction,
  saveFaqAction,
  saveNoticeModalAction,
  savePromoCodesAction,
  saveReviewsAction,
  saveTrackNoteAction,
} from "@/actions/storefront-admin";
import { BRIDGED_ACTIONS, MAX_BRIDGE_ARGS, lookupAction } from "@/lib/mobile/admin-bridge";
import { MCP_ASSET_SCHEMA, resolveMcpImage, type McpMediaKind } from "@/lib/mcp/tenant-media";
import type { McpImageAsset } from "@/lib/mcp/image-assets";
import {
  STORE_ACTION_ALLOWLIST,
  carryPromoUsage,
  isAllowedStoreAction,
  normalizeFooterPatch,
  preparePromoCodes,
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
  writeConfigPatch,
  type StepResult,
  type ToolResult,
} from "@/lib/mcp/owner-scope";

type Tenant = Parameters<typeof ownerStep>[0];

// ── manage_store_content ─────────────────────────────────────────────────

const IMAGE_ROW_PROPS = {
  image: { type: "string", description: "Already-hosted http(s) image URL." },
  imageAsset: { ...MCP_ASSET_SCHEMA, description: "Image to upload instead of image." },
};

export const MANAGE_STORE_CONTENT_TOOL = {
  name: "manage_store_content",
  title: "Manage Store Content",
  description:
    "Edit an existing store's content: FAQ groups, lab reports (COA), customer reviews, promo codes, the notice popup, the track-order delivery note, and the footer (social links, link columns, blurb, disclaimer, copyright). Send only the sections to change. faq, coaReports, reviews and promoCodes are saved WHOLE — send the complete list (read it first with get_store_settings). noticeModal, trackNote and footer are patches. Some sections are plan features: a locked one is reported as failed, never silently skipped.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      faq: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string", description: "Group title, e.g. Shipping." },
            icon: { type: "string", enum: ["shipping", "payment", "product", "default"] },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { q: { type: "string" }, a: { type: "string" } },
                required: ["q", "a"],
              },
            },
          },
          required: ["label", "items"],
        },
      },
      coaReports: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            name: { type: "string", description: "Product/compound tested." },
            lab: { type: "string" },
            date: { type: "string" },
            purity: { type: "string" },
            link: { type: "string", description: "http(s) link to the full report." },
            ...IMAGE_ROW_PROPS,
          },
          required: ["name"],
        },
      },
      reviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            headline: { type: "string" },
            title: { type: "string", description: "Reviewer name or title." },
            subtitle: { type: "string", description: "The review text." },
            badge: { type: "string" },
            productIds: { type: "array", items: { type: "string" } },
            ...IMAGE_ROW_PROPS,
          },
        },
      },
      confirmRemove: { type: "boolean", description: "Required to save a list that drops existing rows." },
      promoCodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            code: { type: "string" },
            type: { type: "string", enum: ["fixed", "percent"] },
            value: { type: "number" },
            minPurchase: { type: "number" },
            usageLimit: { type: ["number", "null"] },
            expiry: { type: ["string", "null"], description: "ISO date, or null for no expiry." },
            active: { type: "boolean" },
          },
          required: ["code", "type", "value"],
        },
      },
      noticeModal: {
        type: "object",
        additionalProperties: false,
        properties: {
          grant: { type: "boolean", description: "Operator grant: true unlocks the popup for this store." },
          enabled: { type: "boolean" },
          title: { type: "string" },
          subtitle: { type: "string" },
          bodyParagraphs: { type: "array", items: { type: "string" } },
          warningTitle: { type: "string" },
          warningBody: { type: "string" },
          deliveryTitle: { type: "string" },
          deliveryLines: { type: "array", items: { type: "string" } },
          agreeLabel: { type: "string" },
          footerNote: { type: "string" },
        },
      },
      trackNote: {
        type: "object",
        description: "Track-order delivery note: {enabled, title, ..., rows:[{region, estimate}]}.",
      },
      footer: {
        type: "object",
        additionalProperties: false,
        properties: {
          socials: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                platform: { type: "string", enum: ["facebook", "instagram", "tiktok", "viber", "whatsapp", "telegram", "twitter"] },
                url: { type: "string" },
                show: { type: "boolean" },
              },
              required: ["platform", "url"],
            },
          },
          columns: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                links: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: { label: { type: "string" }, href: { type: "string" } },
                  },
                },
              },
            },
          },
          blurb: { type: "string" },
          disclaimer: { type: "string" },
          copyright: { type: "string" },
        },
      },
    },
    required: ["tenantSlug"],
  },
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

type ContentPlan = { promoCodes?: Row[]; footerPatch?: Row };

function planContent(args: Row, config: Row): { ok: true; plan: ContentPlan } | { ok: false; error: string } {
  const plan: ContentPlan = {};
  if (args.promoCodes !== undefined) {
    const existing = rowList(config.promoCodes);
    const p = preparePromoCodes(args.promoCodes, existing);
    if (!p.ok) return p;
    const removal = removalError("promo code", p.rows, existing, "code", args.confirmRemove === true);
    if (removal) return { ok: false, error: removal };
    plan.promoCodes = carryPromoUsage(p.rows, existing);
  }
  if (args.footer !== undefined) {
    const f = normalizeFooterPatch(args.footer);
    if (!f.ok) return f;
    plan.footerPatch = f.patch;
  }
  for (const key of ["faq", "coaReports", "reviews"] as const) {
    if (args[key] !== undefined && !Array.isArray(args[key])) return { ok: false, error: `${key} must be a list.` };
  }
  return { ok: true, plan };
}

async function noticeSteps(tenant: Tenant, raw: Row): Promise<StepResult[]> {
  const steps: StepResult[] = [];
  const { grant, ...content } = raw;
  if (typeof grant === "boolean") {
    try {
      await writeConfigPatch(tenant, (current) => {
        const prev = plainObject(current.noticeModal) ?? {};
        return { ...current, noticeModal: normalizeNoticeModal({ ...prev, operatorEnabled: grant }) };
      });
      steps.push({ step: "noticeModal.grant", ok: true });
    } catch (e) {
      steps.push({ step: "noticeModal.grant", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (Object.keys(content).length > 0) {
    const prev = plainObject((await readConfig(tenant.id)).noticeModal) ?? {};
    steps.push(await ownerStep(tenant, "noticeModal", () => saveNoticeModalAction({ ...prev, ...content })));
  }
  return steps;
}

export async function callManageStoreContent(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const { tenant } = resolved;
  const config = await readConfig(tenant.id);

  const planned = planContent(args, config);
  if (!planned.ok) return fail(`Nothing saved. ${planned.error}`);
  const { plan } = planned;

  let coaReports: Row[] | undefined;
  let reviews: Row[] | undefined;
  try {
    if (args.coaReports !== undefined) {
      coaReports = await uploadRowImages(tenant, rowList(args.coaReports), "imageAsset", "image", "content", "name");
    }
    if (args.reviews !== undefined) {
      reviews = await uploadRowImages(tenant, rowList(args.reviews), "imageAsset", "image", "content", "title");
    }
  } catch (e) {
    return fail(`Image upload failed — nothing saved. ${e instanceof Error ? e.message : e}`);
  }

  const steps: StepResult[] = [];
  if (args.faq !== undefined) {
    const faq = rowList(args.faq);
    steps.push(await ownerStep(tenant, "faq", () => saveFaqAction(faq)));
  }
  if (coaReports) {
    const rows = coaReports;
    steps.push(await ownerStep(tenant, "coaReports", () => saveCoaReportsAction(rows)));
  }
  if (reviews) {
    const rows = reviews;
    steps.push(await ownerStep(tenant, "reviews", () => saveReviewsAction(rows)));
  }
  if (plan.promoCodes) {
    const rows = plan.promoCodes;
    steps.push(await ownerStep(tenant, "promoCodes", () => savePromoCodesAction(rows)));
  }
  const notice = plainObject(args.noticeModal);
  if (notice) steps.push(...(await noticeSteps(tenant, notice)));

  const trackNote = plainObject(args.trackNote);
  if (trackNote) {
    const prev = plainObject((await readConfig(tenant.id)).trackNote) ?? {};
    steps.push(await ownerStep(tenant, "trackNote", () => saveTrackNoteAction({ ...prev, ...trackNote })));
  }
  if (plan.footerPatch) {
    const patch = plan.footerPatch;
    try {
      await writeConfigPatch(tenant, (current) => ({ ...current, ...patch }));
      steps.push({ step: "footer", ok: true });
    } catch (e) {
      steps.push({ step: "footer", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return stepsResult(tenant, steps);
}

// ── upload_store_image ───────────────────────────────────────────────────

const UPLOAD_KINDS: readonly McpMediaKind[] = ["content", "category", "payment", "product"];

export const UPLOAD_STORE_IMAGE_TOOL = {
  name: "upload_store_image",
  title: "Upload Store Image",
  description:
    "Host an image in an existing store's media folder and return its URL, for any setting that takes an image URL (e.g. inside run_store_admin_action). Most tools also accept an image asset directly — prefer that when one does. If the operator attached an image in chat and you have a temporary download URL for it, pass that URL as image.url.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      image: MCP_ASSET_SCHEMA,
      purpose: { type: "string", enum: [...UPLOAD_KINDS], description: "Media-library tag. Defaults to content." },
    },
    required: ["tenantSlug", "image"],
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

export async function callUploadStoreImage(args: Row): Promise<ToolResult> {
  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const asset = plainObject(args.image);
  if (!asset) return fail("image is required: {url} or {dataUrl} or {dataBase64, mimeType}.");
  const kind = UPLOAD_KINDS.includes(args.purpose as McpMediaKind) ? (args.purpose as McpMediaKind) : "content";
  try {
    const uploaded = await resolveMcpImage(resolved.tenant.id, asset as McpImageAsset, kind);
    return ok({ tenant: { slug: resolved.tenant.slug }, url: uploaded.url });
  } catch (e) {
    return fail(`Upload failed. ${e instanceof Error ? e.message : e}`);
  }
}

// ── run_store_admin_action ───────────────────────────────────────────────

const ACTION_LIST = Object.entries(STORE_ACTION_ALLOWLIST)
  .map(([name, args]) => `${name} ${args}`)
  .join("\n");

export const RUN_STORE_ADMIN_ACTION_TOOL = {
  name: "run_store_admin_action",
  title: "Run Store Admin Setting",
  description: `Change any other store-admin setting of an existing store by running the same save the store's #admin panel runs, as the store owner (plan locks and validation apply). Prefer the dedicated tools when one fits. args is the positional argument list. Most saves REPLACE the whole setting, so read the current value first (get_store_settings, or the matching get… action). Available actions and their args:\n${ACTION_LIST}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: TOKEN_SCHEMA,
      tenantSlug: TENANT_SCHEMA,
      action: { type: "string", enum: Object.keys(STORE_ACTION_ALLOWLIST) },
      args: { type: "array", description: `Positional arguments, at most ${MAX_BRIDGE_ARGS}.` },
    },
    required: ["tenantSlug", "action"],
  },
  annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

export async function callRunStoreAdminAction(args: Row): Promise<ToolResult> {
  if (!isAllowedStoreAction(args.action)) {
    return fail(`Unknown or unavailable action "${String(args.action)}". Use one of: ${Object.keys(STORE_ACTION_ALLOWLIST).join(", ")}.`);
  }
  const action = lookupAction(BRIDGED_ACTIONS, args.action);
  if (!action) return fail(`Action "${args.action}" is not available on this server.`);
  const list = args.args === undefined ? [] : args.args;
  if (!Array.isArray(list) || list.length > MAX_BRIDGE_ARGS) return fail(`args must be a list of at most ${MAX_BRIDGE_ARGS}.`);

  const resolved = await resolveTenant(args.tenantSlug);
  if (!resolved.ok) return resolved.result;
  const step = await ownerStep(resolved.tenant, args.action, () => action(...list));
  return stepsResult(resolved.tenant, [step], step.detail === undefined ? {} : { result: step.detail });
}
