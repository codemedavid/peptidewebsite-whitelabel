import "server-only";
import { promises as dns } from "node:dns";

/**
 * DNS-based custom-domain verification.
 *
 * No external API tokens required. We resolve the hostname's DNS records and
 * compare them to what the platform expects (Vercel's CNAME or A record). The
 * domain still needs to be attached to the hosting project (Vercel dashboard
 * or a wildcard) for TLS + routing — DNS verification only confirms the
 * customer pointed their DNS at us.
 */

export type VerificationRecord = {
  type: string; // "A" | "CNAME"
  domain: string; // the FQDN the record is set on
  value: string; // record value the customer should set
  reason?: string; // optional detail (e.g. "Found CNAME → other.example.com")
};

export type DomainStatus = {
  /** DNS resolves to our platform target. */
  verified: boolean;
  /** DNS is missing or points elsewhere — show the customer the records below. */
  misconfigured: boolean;
  /** Records the customer should add (empty when verified). */
  verification: VerificationRecord[];
};

/** Vercel's recommended A record for apex domains. */
const APEX_A_RECORDS = ["76.76.21.21"];
/** Vercel's CNAME target for subdomains. */
const CNAME_TARGET = "cname.vercel-dns.com";

function isApex(hostname: string): boolean {
  return hostname.split(".").length <= 2;
}

/** The DNS record we recommend the customer add at their provider. */
export function recommendedRecord(hostname: string): VerificationRecord {
  return isApex(hostname)
    ? { type: "A", domain: hostname, value: APEX_A_RECORDS[0] }
    : { type: "CNAME", domain: hostname, value: CNAME_TARGET };
}

function normalizeCname(c: string): string {
  return c.replace(/\.$/, "").toLowerCase();
}

/**
 * Look up the hostname's DNS and report whether it points at the platform.
 * Apex domains are checked via A record; subdomains prefer CNAME with A as a
 * fallback. If no record exists yet, we report misconfigured (not an error).
 */
export async function checkDnsStatus(hostname: string): Promise<DomainStatus> {
  const expected = recommendedRecord(hostname);

  if (!isApex(hostname)) {
    try {
      const cnames = await dns.resolveCname(hostname);
      const matched = cnames.some((c) => normalizeCname(c) === CNAME_TARGET);
      if (matched) return { verified: true, misconfigured: false, verification: [] };
      return {
        verified: false,
        misconfigured: true,
        verification: [
          { ...expected, reason: `Found CNAME → ${cnames.map(normalizeCname).join(", ")}` },
        ],
      };
    } catch {
      // No CNAME — fall through to the A-record path so customers who set an
      // A record on a subdomain (uncommon but valid) still verify.
    }
  }

  try {
    const ips = await dns.resolve4(hostname);
    const matched = ips.some((ip) => APEX_A_RECORDS.includes(ip));
    if (matched) return { verified: true, misconfigured: false, verification: [] };
    return {
      verified: false,
      misconfigured: true,
      verification: [{ ...expected, reason: `Found A → ${ips.join(", ")}` }],
    };
  } catch {
    return { verified: false, misconfigured: true, verification: [expected] };
  }
}
