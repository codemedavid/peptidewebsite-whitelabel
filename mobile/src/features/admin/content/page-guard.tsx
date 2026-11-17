import type { ReactNode } from "react";
import { Linking } from "react-native";
import { useSignedIn } from "@/auth/SessionProvider";
import type { AdminBrand } from "@/features/admin/bridge";
import { EmptyState } from "@/ui/feedback";
import { Button } from "@/ui/primitives";

/**
 * The website guards these editors with isAdminViewVisible
 * (src/storefront/visibility.ts ADMIN_VIEW_TOGGLE), so a deep link can't open
 * a module the store has switched off. The app's menu is already filtered by
 * the server; this repeats the check for a screen reached any other way.
 */
const VIEW_TOGGLE = {
  faq: (b: AdminBrand) => b.showPageFAQ !== false,
  lab: (b: AdminBrand) => b.showPageCOA !== false,
  proto: (b: AdminBrand) => b.showPageProtocols !== false,
  reviews: (b: AdminBrand) => b.showPageReviews !== false,
  design: (b: AdminBrand) => b.showAdminCardStudio !== false,
} as const;

export type GuardedView = keyof typeof VIEW_TOGGLE;

export function ViewGate({ brand, view, label, children }: { brand: AdminBrand; view: GuardedView; label: string; children: ReactNode }) {
  if (VIEW_TOGGLE[view](brand)) return <>{children}</>;
  return (
    <EmptyState
      icon="eye-off-outline"
      title={`${label} is switched off`}
      body="This page isn't turned on for your store. Ask your provider to switch it on."
    />
  );
}

/** The website's "Preview Public Page" — opens the live store page in the browser. */
export function PreviewPublicPage({ hash }: { hash: "faq" | "coa" | "protocols" | "reviews" }) {
  const { me } = useSignedIn();
  const base = me.store.websiteUrl.replace(/\/+$/, "");
  return (
    <Button
      label="Preview public page"
      icon="open-outline"
      variant="ghost"
      onPress={() => void Linking.openURL(`${base}/#${hash}`).catch(() => undefined)}
    />
  );
}

export function isViewVisible(brand: AdminBrand, view: GuardedView): boolean {
  return VIEW_TOGGLE[view](brand);
}

export function HiddenView({ label }: { label: string }) {
  return (
    <EmptyState
      icon="eye-off-outline"
      title={`${label} is switched off`}
      body="This page isn't turned on for your store. Ask your provider to switch it on."
    />
  );
}
