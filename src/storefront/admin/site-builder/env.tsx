"use client";

// The Website Layout editor's ENVIRONMENT — everything its panels need from the
// app around them, behind one small interface. The same panels run in two
// places with different plumbing:
//
//   • the store admin (#admin → Website Layout): the owner's StoreProvider,
//     store-admin server actions, the store's ImageKit folder;
//   • the platform admin (Super Admin → tenant → Branding): no StoreProvider,
//     operator-scoped actions, edits ride "Save branding".
//
// Panels read this through useSiteBuilderEnv() and never import either side's
// store or actions directly.

import { createContext, useContext, type ReactNode } from "react";
import type { Category } from "../../types";
import type { NewsletterSubscriber } from "@/actions/intl-local";

export type SiteBuilderEnv = {
  toast: (msg: string) => void;
  /** The tenant's categories, for "shop, one category" links. */
  categories: Category[];
  /** International (USD) selling — the switch on the Markets tab. */
  intl: {
    enabled: boolean;
    /** Flip it. `savesImmediately` decides the hint shown beside the switch. */
    setEnabled: (enabled: boolean) => Promise<{ ok: true } | { error: string }>;
    savesImmediately: boolean;
  };
  /** Newsletter subscriber tools — null where they aren't available (the
   *  platform admin, which edits the layout but not the store's contacts). */
  subscribers: {
    list: () => Promise<{ subscribers: NewsletterSubscriber[] } | { error: string }>;
    unsubscribe: (id: string) => Promise<{ ok: true } | { error: string }>;
  } | null;
};

const SiteBuilderEnvContext = createContext<SiteBuilderEnv | null>(null);

export function SiteBuilderEnvProvider({ env, children }: { env: SiteBuilderEnv; children: ReactNode }) {
  return <SiteBuilderEnvContext.Provider value={env}>{children}</SiteBuilderEnvContext.Provider>;
}

export function useSiteBuilderEnv(): SiteBuilderEnv {
  const env = useContext(SiteBuilderEnvContext);
  if (!env) throw new Error("useSiteBuilderEnv() outside <SiteBuilderEnvProvider>");
  return env;
}
