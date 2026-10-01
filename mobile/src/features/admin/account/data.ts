import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "../bridge";
import { setupKeys } from "../setup/data";
import type { BillingInfo, ExportBundle, InvoiceRow, StaffMember, UpgradeContext } from "./rules";

/**
 * Reads + writes for the Team & account screens (staff, billing, export,
 * upgrade). Every call is the website's own server action run as this app user
 * through the admin bridge; `{ error }` answers become thrown Errors carrying the
 * website's wording. Keys live under setupKeys.all so any admin save refreshes them.
 */

export const accountKeys = {
  staff: (scope: string) => [...setupKeys.all(scope), "staff"] as const,
  billingInfo: (scope: string) => [...setupKeys.all(scope), "billing", "info"] as const,
  invoices: (scope: string) => [...setupKeys.all(scope), "billing", "invoices"] as const,
  upgrade: (scope: string) => [...setupKeys.all(scope), "upgrade"] as const,
  menu: (scope: string) => [scope, "admin", "menu"] as const,
};

type Err = { error: string };

/** Run one allowlisted website action and unwrap `{ error }`. */
export async function callAction<T>(fn: string, ...args: unknown[]): Promise<Exclude<T, Err>> {
  return unwrap(await adminBridge.call<T | Err>(fn, ...args)) as Exclude<T, Err>;
}

export function useStaffList() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: accountKeys.staff(scope),
    queryFn: async () => (await callAction<{ ok: true; items: StaffMember[] }>("listStaffAction")).items,
  });
}

export function useBillingInfo() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: accountKeys.billingInfo(scope),
    queryFn: () => callAction<BillingInfo>("getBillingPaymentInfoAction"),
  });
}

export function useInvoices() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: accountKeys.invoices(scope),
    queryFn: async () => (await callAction<{ payments: InvoiceRow[] }>("listMySubscriptionPaymentsAction")).payments,
  });
}

export function useUpgradeContext() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: accountKeys.upgrade(scope),
    queryFn: () => callAction<UpgradeContext>("getUpgradeContextAction"),
  });
}

/** Always a fresh build — an export must never hand back yesterday's numbers. */
export const buildExport = async (): Promise<ExportBundle> =>
  (await callAction<{ ok: true; bundle: ExportBundle }>("exportStoreDataAction")).bundle;

/** Refresh every admin read (menu, brand, dashboard) after a plan-changing call. */
export function useRefreshAdmin() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return () => {
    // setupKeys.all is the [scope, "admin"] prefix — brand, menu and these reads.
    void qc.invalidateQueries({ queryKey: setupKeys.all(scope) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
  };
}
