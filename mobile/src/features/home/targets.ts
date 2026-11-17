import { router, type Href } from "expo-router";
import type { DashboardAlertTarget, DashboardGbRoundRef } from "@contract";

/**
 * Where each Home alert / card link leads in the app — the native twin of the
 * website dashboard's `go(view)` (AdminDashboard.tsx). Every target screen runs
 * its own permission check server-side, so a link is never a way past a grant.
 */

export const roundHref = (round: DashboardGbRoundRef): Href =>
  `/manage/group-buys-detail?id=${encodeURIComponent(round.id)}&name=${encodeURIComponent(round.name)}` as Href;

export function openAlertTarget(target: DashboardAlertTarget, round: DashboardGbRoundRef | null): void {
  switch (target) {
    case "inventory":
      return void router.navigate("/products");
    case "orders":
      return void router.navigate({ pathname: "/orders", params: { filter: "to-fulfil", at: String(Date.now()) } });
    case "categories":
      return void router.push("/manage/categories");
    case "gb-joins":
      return void router.push("/manage/join-requests");
    case "gb-round":
      return void router.push(round ? roundHref(round) : "/manage/group-buys");
    case "group-buys":
      return void router.push("/manage/group-buys");
  }
}
