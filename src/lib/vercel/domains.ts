import "server-only";

/**
 * Thin Vercel Domains API client used to provision per-tenant custom domains.
 *
 * A custom domain (e.g. `shop.acme.com`) must be attached to the Vercel project
 * before Vercel will route it to this deployment and issue a TLS certificate.
 * We register it here, then poll its config to learn whether the customer's DNS
 * is pointed correctly. Once verified, the caller flips `Domain.verified` in the
 * DB so resolveTenantByHost() will accept it.
 *
 * Configure with the VERCEL_* env vars (see .env.example). When unconfigured we
 * fail loudly rather than silently no-op, so the admin UI can surface it.
 */

const API = "https://api.vercel.com";

export type VerificationRecord = {
  type: string; // "TXT" | "CNAME" | "A" | …
  domain: string; // the FQDN the record is set on
  value: string; // record value
  reason?: string;
};

export type DomainStatus = {
  /** Vercel considers the domain attached AND its DNS correctly configured. */
  verified: boolean;
  /** DNS is missing/incorrect — show the customer the records below. */
  misconfigured: boolean;
  /** Ownership/configuration records Vercel wants set (may be empty). */
  verification: VerificationRecord[];
};

export type VercelResult<T> = { ok: true; data: T } | { ok: false; error: string };

function config():
  | { ok: true; token: string; projectId: string; teamQuery: string }
  | { ok: false; error: string } {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId) {
    return {
      ok: false,
      error:
        "Vercel API is not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for team projects).",
    };
  }
  // teamId is optional (personal accounts don't have one).
  const teamQuery = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  return { ok: true, token, projectId, teamQuery };
}

async function call(
  path: string,
  init: RequestInit & { token: string },
): Promise<VercelResult<unknown>> {
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach the Vercel API." };
  }
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!res.ok) {
    return {
      ok: false,
      error: body?.error?.message ?? `Vercel API error (${res.status}).`,
    };
  }
  return { ok: true, data: body };
}

/**
 * Attach a domain to the Vercel project. Idempotent: a domain that's already
 * attached returns success so re-adding doesn't error.
 */
export async function addDomainToProject(hostname: string): Promise<VercelResult<null>> {
  const cfg = config();
  if (!cfg.ok) return cfg;
  const res = await call(`/v10/projects/${cfg.projectId}/domains${cfg.teamQuery}`, {
    method: "POST",
    token: cfg.token,
    body: JSON.stringify({ name: hostname }),
  });
  if (!res.ok) {
    // "domain already in use by this project" → treat as success.
    if (/already (in use|exists)/i.test(res.error)) return { ok: true, data: null };
    return res;
  }
  return { ok: true, data: null };
}

/** Detach a domain from the Vercel project. A 404 is treated as success. */
export async function removeDomainFromProject(hostname: string): Promise<VercelResult<null>> {
  const cfg = config();
  if (!cfg.ok) return cfg;
  const res = await call(
    `/v9/projects/${cfg.projectId}/domains/${encodeURIComponent(hostname)}${cfg.teamQuery}`,
    { method: "DELETE", token: cfg.token },
  );
  if (!res.ok && !/not found/i.test(res.error)) return res;
  return { ok: true, data: null };
}

/**
 * Read the current verification/configuration status of a project domain.
 * Combines the project-domain record (`verified` + ownership `verification`
 * records) with the DNS config endpoint (`misconfigured`).
 */
export async function getDomainStatus(hostname: string): Promise<VercelResult<DomainStatus>> {
  const cfg = config();
  if (!cfg.ok) return cfg;
  const enc = encodeURIComponent(hostname);

  const domainRes = await call(
    `/v9/projects/${cfg.projectId}/domains/${enc}${cfg.teamQuery}`,
    { method: "GET", token: cfg.token },
  );
  if (!domainRes.ok) return domainRes;
  const domain = domainRes.data as {
    verified?: boolean;
    verification?: VerificationRecord[];
  };

  const configRes = await call(`/v6/domains/${enc}/config${cfg.teamQuery}`, {
    method: "GET",
    token: cfg.token,
  });
  // The config endpoint is best-effort; if it fails, fall back to !verified.
  const misconfigured = configRes.ok
    ? Boolean((configRes.data as { misconfigured?: boolean }).misconfigured)
    : !domain.verified;

  return {
    ok: true,
    data: {
      verified: Boolean(domain.verified) && !misconfigured,
      misconfigured,
      verification: domain.verification ?? [],
    },
  };
}
