import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { success } from "@/features/admin/setup/data";
import type { ResellerSettings } from "./model";

/** getResellerSettingsAction / saveResellerSettingsAction through the admin bridge. */

const resellerKey = (scope: string) => [scope, "admin", "reseller"] as const;

export function useResellerSettings() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: resellerKey(scope),
    queryFn: async () => unwrap(await adminBridge.call<ResellerSettings | { error: string }>("getResellerSettingsAction")),
  });
}

/**
 * The website's payload shapes:
 *   { code?, merchantGateTitle, merchantGateSub } — `code` omitted keeps the password
 *   { code: "", clear: true }                     — removes it and signs resellers out
 */
export type ResellerSavePayload =
  | { code?: string; merchantGateTitle: string; merchantGateSub: string }
  | { code: ""; clear: true };

export function useSaveReseller() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ResellerSavePayload) =>
      unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveResellerSettingsAction", payload)),
    onSuccess: () => {
      success();
      void qc.invalidateQueries({ queryKey: resellerKey(scope) });
    },
  });
}
