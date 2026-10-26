import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";

/**
 * Paid group-buy access for the store team — the website's own actions
 * (actions/gb-review.ts) through the admin bridge, so every rule (the
 * `groupbuys` permission, the lifecycle, no self-review) stays on the server.
 * Shapes mirror lib/storefront/gb-review.server.ts (the app can't import it).
 */

export type JoinStatus = "pending_payment" | "paid_pending_approval" | "approved" | "rejected" | "refunded" | "revoked";

export type JoinRequest = {
  id: string;
  groupBuyId: string;
  roundName: string;
  customerName: string;
  customerEmail: string;
  status: JoinStatus | string;
  amountCents: number;
  method: string;
  reference: string;
  paidAt: string | null;
  submittedAt: string | null;
  reviewReason: string;
  refundReference: string;
  hasReceipt: boolean;
  duplicateReference: boolean;
  history: { toStatus: string; actorKind: string; reason: string; at: string }[];
};

export type JoinCounts = Record<JoinStatus, number>;
export type ReviewAction = "approve" | "reject" | "refund" | "revoke";

export type PaidJoinRound = { id: string; name: string; status: string; productIds: string[]; paidJoin?: boolean; joinFeeCents?: number };

export const joinKeys = {
  all: (scope: string) => [scope, "gb-joins"] as const,
  list: (scope: string, status: string) => [scope, "gb-joins", "list", status] as const,
  rounds: (scope: string) => [scope, "gb-joins", "rounds"] as const,
};

export function useJoinRequests(status: JoinStatus | "all") {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: joinKeys.list(scope, status),
    queryFn: () =>
      callAction<{ ok: true; requests: JoinRequest[]; counts: JoinCounts }>("listGroupBuyJoinRequestsAction", {
        status: status === "all" ? undefined : status,
      }),
  });
}

export function usePaidJoinRounds() {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: joinKeys.rounds(scope),
    queryFn: async () => (await callAction<{ ok: true; groupBuys: PaidJoinRound[] }>("listGroupBuysAction")).groupBuys,
  });
}

export function useReviewJoinRequest() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; action: ReviewAction; reason?: string; refundReference?: string }) =>
      callAction<{ ok: true; request: JoinRequest }>("reviewGroupBuyJoinRequestAction", input),
    onSettled: () => void qc.invalidateQueries({ queryKey: joinKeys.all(scope) }),
  });
}

export function useSavePaidJoin() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; paidJoin: boolean; joinFee: string }) =>
      callAction<{ ok: true; groupBuy: PaidJoinRound }>("saveGroupBuyPaidJoinAction", input),
    onSettled: () => void qc.invalidateQueries({ queryKey: joinKeys.all(scope) }),
  });
}

export function receiptUrl(id: string) {
  return callAction<{ ok: true; url: string }>("getGroupBuyJoinReceiptAction", id);
}

export const JOIN_STATUS_LABEL: Record<string, string> = {
  pending_payment: "Not paid yet",
  paid_pending_approval: "Waiting for approval",
  approved: "Approved",
  rejected: "Refund owed",
  refunded: "Refunded",
  revoked: "Access removed",
};
