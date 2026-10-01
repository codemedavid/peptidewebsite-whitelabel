"use client";

// Client-side view of "who is signed in on this store", shared by the account
// page and the checkout drawer (which prefills name / email / phone from it).
// One fetch per page load, then kept in sync by notifyCustomerAccountChanged —
// the session itself is the httpOnly cookie; this is only a display cache.

import { useEffect, useState } from "react";
import { getCustomerAccountAction, type CustomerAccount } from "@/actions/customer-accounts";

type Listener = (a: CustomerAccount | null) => void;

let current: CustomerAccount | null | undefined; // undefined = not fetched yet
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();

export function notifyCustomerAccountChanged(a: CustomerAccount | null): void {
  current = a;
  for (const l of listeners) l(a);
}

function load(): Promise<void> {
  inflight ??= getCustomerAccountAction()
    .then((a) => notifyCustomerAccountChanged(a))
    .catch(() => notifyCustomerAccountChanged(null));
  return inflight;
}

/** The signed-in customer, or null. `enabled` false (feature off) never fetches. */
export function useCustomerAccount(enabled: boolean): CustomerAccount | null {
  const [account, setAccount] = useState<CustomerAccount | null>(current ?? null);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setAccount);
    if (current === undefined) void load();
    else setAccount(current);
    return () => {
      listeners.delete(setAccount);
    };
  }, [enabled]);
  return enabled ? account : null;
}
