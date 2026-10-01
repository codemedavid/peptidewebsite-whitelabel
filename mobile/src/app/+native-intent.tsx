import { offerStoreLink } from "@/store-link/pending";
import { storeFromUrl } from "@/store-link/parse";

/**
 * Every link that opens the app passes through here first (cold start and
 * while running). A store link (pepwebadmin://store/<slug>, from a store's
 * /app page) is handed to StoreLinkProvider and the router goes home — there
 * is no /store route; the linked store is app state, not a screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const store = storeFromUrl(path);
    if (store) {
      offerStoreLink(store);
      return "/";
    }
    return path;
  } catch {
    return "/";
  }
}
