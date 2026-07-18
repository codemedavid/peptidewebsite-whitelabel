// Auth audit trail. The original port had none; this records the security-
// relevant auth events so a tenant can see who rotated the access code and when
// admin logins succeeded or failed.
//
// Design rule: recording an audit row must NEVER break the flow it records. A
// failed INSERT while logging admin_login_failed must not turn a clean 401 into
// a 500. recordAuthAudit is therefore fail-safe, and the DB write is injected so
// the guarantee is unit-testable without a database.

export const AUTH_AUDIT_EVENTS = ["code_rotated", "admin_login", "admin_login_failed"] as const;
export type AuthAuditEvent = (typeof AUTH_AUDIT_EVENTS)[number];

export type AuthAuditRow = {
  tenantId: string;
  event: AuthAuditEvent;
  ip: string | null;
};

/** The DB write, injected. Production passes a prisma authAudit.create; tests
 *  pass a stub. */
export type AuthAuditWriter = (row: AuthAuditRow) => Promise<unknown>;

/**
 * Record one auth event. Fail-safe: any error from the writer is swallowed so
 * audit logging can never break login or code rotation. Returns once the write
 * settles (or fails) — callers may await or fire-and-forget.
 */
export async function recordAuthAudit(
  write: AuthAuditWriter,
  entry: { tenantId: string; event: AuthAuditEvent; ip?: string | null },
): Promise<void> {
  try {
    await write({ tenantId: entry.tenantId, event: entry.event, ip: entry.ip ?? null });
  } catch {
    // Best-effort by design — see the module header.
  }
}
