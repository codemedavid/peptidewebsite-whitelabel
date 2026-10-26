import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import type { PaidAccessDecision, PaidAccessSettings, QueueResult, QueueTab, SettingsError, SettingsView } from "./model";

/**
 * Paid Access for the store team — the website's own actions
 * (src/modules/paid-access/actions.ts) through the admin bridge, so every rule (the
 * `groupbuys` permission, the status machine, no self-review) stays on the
 * server. These actions answer `{ ok: false, code, message }` on a refusal;
 * `paidAccessCall` turns that into a thrown PaidAccessError carrying any field errors.
 *
 * Keys live under [scope, "admin"] so any admin save elsewhere refreshes them.
 */

export class PaidAccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** Field-level refusals from savePaidAccessSettingsAction (path → message). */
    readonly errors: SettingsError[] = [],
  ) {
    super(message);
    this.name = "PaidAccessError";
  }
}

type Refusal = { ok: false; code: string; message: string; errors?: SettingsError[] };

async function paidAccessCall<T>(fn: string, ...args: unknown[]): Promise<T> {
  const result = unwrap(await adminBridge.call<T | Refusal | { error: string }>(fn, ...args));
  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    const r = result as Refusal;
    throw new PaidAccessError(r.code, r.message || "Something went wrong. Please try again.", Array.isArray(r.errors) ? r.errors : []);
  }
  return result as T;
}

export const paidAccessKeys = {
  all: (scope: string) => [scope, "admin", "paid-access"] as const,
  queue: (scope: string, tab: QueueTab, groupBuyId: string) => [scope, "admin", "paid-access", "queue", tab, groupBuyId] as const,
  settings: (scope: string, groupBuyId: string) => [scope, "admin", "paid-access", "settings", groupBuyId] as const,
};

/** One queue tab (and the counts for every tab). `groupBuyId` "" = every round. */
export function usePaidAccessQueue(tab: QueueTab, groupBuyId = "") {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: paidAccessKeys.queue(scope, tab, groupBuyId),
    queryFn: () => paidAccessCall<QueueResult>("listPaidAccessQueueAction", { tab, ...(groupBuyId ? { groupBuyId } : {}) }),
  });
}

/** Approve / reject / refund / revoke / confirm or reject a proof. Refetches the queue either way. */
export function usePaidAccessDecide() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: PaidAccessDecision) => paidAccessCall<{ ok: true; membershipId: string; status: string }>("decidePaidAccessAction", decision),
    onSettled: () => void qc.invalidateQueries({ queryKey: paidAccessKeys.all(scope) }),
  });
}

export function usePaidAccessSettings(groupBuyId: string) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: paidAccessKeys.settings(scope, groupBuyId),
    enabled: !!groupBuyId,
    queryFn: () => paidAccessCall<SettingsView>("getPaidAccessSettingsAction", groupBuyId),
  });
}

/** Saves and writes the server's fresh view straight into the cache. */
export function useSavePaidAccessSettings(groupBuyId: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: PaidAccessSettings) => paidAccessCall<SettingsView>("savePaidAccessSettingsAction", groupBuyId, settings),
    onSuccess: (view) => {
      qc.setQueryData(paidAccessKeys.settings(scope, groupBuyId), view);
      void qc.invalidateQueries({ queryKey: [...paidAccessKeys.all(scope), "queue"] });
    },
  });
}

/** A 10-minute signed link to one payment's proof. */
export async function paidAccessProofUrl(paymentId: string): Promise<string> {
  return (await paidAccessCall<{ ok: true; url: string }>("getPaidAccessProofUrlAction", paymentId)).url;
}
