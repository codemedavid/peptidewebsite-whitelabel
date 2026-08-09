import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createTenantWithSetup, type TenantSetupInput } from "@/lib/tenant/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "pepweb-whitelabel-admin",
  title: "Pepweb Whitelabel Admin",
  version: "1.0.0",
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

const CREATE_TENANT_TOOL = {
  name: "create_whitelabel_tenant",
  title: "Create Whitelabel Tenant",
  description:
    "Use this when a platform operator asks ChatGPT to create a Pepweb whitelabel tenant and configure its logo, favicon, default product image, and homepage hero. This is a write action that creates a live tenant record. Do not call it unless the user has explicitly asked to create or provision a tenant.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adminToken: {
        type: "string",
        description:
          "Optional fallback token for testing when ChatGPT is configured with No Authentication. Prefer Authorization: Bearer via the connector settings.",
      },
      name: { type: "string", description: "Business/store name, e.g. Nordic Peptides." },
      slug: {
        type: "string",
        description: "Subdomain slug using lowercase letters, numbers, and hyphens, e.g. nordic-peptides.",
      },
      planKey: {
        type: "string",
        enum: ["starter", "pro", "enterprise"],
        description: "Package plan. Defaults to pro.",
      },
      status: {
        type: "string",
        enum: ["trial", "active", "pending_setup"],
        description: "Initial tenant status. Use trial unless the operator says to publish immediately.",
      },
      themeId: { type: "string", description: "Theme preset id. Defaults to clinical-white." },
      ownerEmail: {
        type: "string",
        description: "Owner email. If omitted, the configured MCP fallback owner email is used.",
      },
      ownerUserId: {
        type: "string",
        description: "Supabase auth user id for the owner. If omitted, the configured MCP fallback owner id is used.",
      },
      storeAdminEmail: { type: "string", description: "Store admin email. Defaults to ownerEmail." },
      supportEmail: { type: "string", description: "Public support email. Defaults to ownerEmail." },
      industry: { type: "string", description: "Short industry/category label for the storefront." },
      description: { type: "string", description: "Short store description used for hero fallback copy." },
      currency: { type: "string", description: "Store currency symbol or ISO code, e.g. PHP, ₱, USD, SAR." },
      logo: { $ref: "#/$defs/asset" },
      favicon: { $ref: "#/$defs/asset" },
      defaultProductImage: { $ref: "#/$defs/asset" },
      hero: {
        type: "object",
        additionalProperties: false,
        properties: {
          chip: { type: "string" },
          line1: { type: "string" },
          line2: { type: "string" },
          sub: { type: "string" },
          cta1: { type: "string" },
          cta2: { type: "string" },
          cta1LinkType: { type: "string", enum: ["page", "custom"] },
          cta1LinkPage: { type: "string" },
          cta1LinkUrl: { type: "string" },
          cta2LinkType: { type: "string", enum: ["page", "custom"] },
          cta2LinkPage: { type: "string" },
          cta2LinkUrl: { type: "string" },
          image: { $ref: "#/$defs/asset" },
          imageAlt: { type: "string" },
          imageRatio: { type: "string", enum: ["wide", "standard", "tall"] },
          imageFocus: { type: "string", enum: ["center", "top", "bottom", "left", "right"] },
          imageOverlay: { type: "boolean" },
          imageScrim: { type: "number" },
          imageLinkType: { type: "string", enum: ["page", "custom", "none"] },
          imageLinkPage: { type: "string" },
          imageLinkUrl: { type: "string" },
        },
      },
    },
    required: ["name", "slug"],
    $defs: {
      asset: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            description:
              "Public http(s) URL for the image. By default the server downloads and rehosts it to the tenant ImageKit folder.",
          },
          dataUrl: { type: "string", description: "Base64 data URL, e.g. data:image/png;base64,..." },
          dataBase64: { type: "string", description: "Raw base64 file bytes." },
          mimeType: { type: "string", description: "Required with dataBase64, e.g. image/png." },
          fileName: { type: "string" },
          upload: {
            type: "boolean",
            description:
              "Defaults to true. Set false to store an existing hosted URL directly instead of rehosting it.",
          },
        },
      },
    },
  },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function textResponse(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() ?? "";
}

function requireMcpAuth(req: NextRequest, args: Record<string, unknown>): string | null {
  const expected = process.env.MCP_ADMIN_TOKEN?.trim();
  if (!expected) return "MCP_ADMIN_TOKEN is not configured on the server.";

  const supplied = bearerToken(req) || String(args.adminToken ?? "").trim();
  if (!supplied || supplied !== expected) return "Invalid or missing MCP admin token.";
  return null;
}

function fallbackOwner() {
  return {
    ownerUserId: process.env.MCP_OWNER_USER_ID?.trim() || process.env.OWNER_USER_ID?.trim() || "",
    ownerEmail: process.env.MCP_OWNER_EMAIL?.trim() || process.env.OWNER_EMAIL?.trim() || "",
  };
}

async function callCreateTenant(req: NextRequest, args: Record<string, unknown>) {
  const authError = requireMcpAuth(req, args);
  if (authError) {
    return {
      content: [{ type: "text", text: authError }],
      isError: true,
    };
  }

  const owner = fallbackOwner();
  const ownerUserId = String(args.ownerUserId ?? owner.ownerUserId).trim();
  const ownerEmail = String(args.ownerEmail ?? owner.ownerEmail).trim();
  if (!ownerUserId || !ownerEmail) {
    return {
      content: [
        {
          type: "text",
          text: "Set MCP_OWNER_USER_ID and MCP_OWNER_EMAIL, or provide ownerUserId and ownerEmail in the tool call.",
        },
      ],
      isError: true,
    };
  }

  try {
    const input = {
      ...args,
      ownerUserId,
      ownerEmail,
    } as unknown as TenantSetupInput;
    const tenant = await createTenantWithSetup(input);
    const text = JSON.stringify(tenant, null, 2);
    return {
      content: [{ type: "text", text }],
      structuredContent: tenant,
      isError: false,
    };
  } catch (e) {
    const text =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
        ? `Slug "${String(args.slug ?? "")}" is already taken.`
        : e instanceof Error
          ? e.message
          : "Failed to create tenant.";
    return {
      content: [{ type: "text", text }],
      isError: true,
    };
  }
}

async function handleMessage(req: NextRequest, message: JsonRpcRequest) {
  const method = String(message.method ?? "");

  if (!method) return jsonRpcError(message.id, -32600, "Invalid Request");

  if (method === "initialize") {
    const params = paramsObject(message.params);
    const requestedVersion = String(params.protocolVersion || MCP_PROTOCOL_VERSION);
    return jsonRpcResult(message.id, {
      protocolVersion: requestedVersion,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions:
        "This MCP server creates Pepweb whitelabel tenants. Only call create_whitelabel_tenant after the operator explicitly asks to create a tenant. Ask for missing required tenant details before calling.",
    });
  }

  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return jsonRpcResult(message.id, {});

  if (method === "tools/list") {
    return jsonRpcResult(message.id, { tools: [CREATE_TENANT_TOOL] });
  }

  if (method === "tools/call") {
    const params = paramsObject(message.params);
    const name = String(params.name ?? "");
    const args = paramsObject(params.arguments);
    if (name !== CREATE_TENANT_TOOL.name) {
      return jsonRpcError(message.id, -32602, `Unknown tool: ${name}`);
    }
    return jsonRpcResult(message.id, await callCreateTenant(req, args));
  }

  return jsonRpcError(message.id, -32601, `Method not found: ${method}`);
}

export async function OPTIONS() {
  return response({}, 204);
}

export async function GET() {
  return textResponse(
    "Pepweb MCP server is running. Use this URL as the ChatGPT MCP Server URL.",
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return response(jsonRpcError(null, -32700, "Parse error"), 400);
  }

  try {
    if (Array.isArray(body)) {
      const replies = (await Promise.all(body.map((msg) => handleMessage(req, msg as JsonRpcRequest)))).filter(
        Boolean,
      );
      return response(replies);
    }
    const reply = await handleMessage(req, body as JsonRpcRequest);
    return reply ? response(reply) : new NextResponse(null, { status: 202 });
  } catch (e) {
    const id = paramsObject(body).id as JsonRpcId | undefined;
    return response(jsonRpcError(id, -32603, e instanceof Error ? e.message : "Internal error"), 500);
  }
}
