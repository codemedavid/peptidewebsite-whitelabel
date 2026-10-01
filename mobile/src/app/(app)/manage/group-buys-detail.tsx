import { Stack, useLocalSearchParams } from "expo-router";
import { useAdminBrand } from "@/features/admin/setup/data";
import { useGroupBuyDashboard } from "@/features/admin/group-buys/hooks";
import { RoundDashboard } from "@/features/admin/group-buys/Dashboard";
import { ErrorState, SkeletonList } from "@/ui/feedback";

/**
 * One group buy's dashboard (the website's "groupbuy-detail" view), opened from
 * a round on the Group buys screen: /manage/group-buys-detail?id=…&name=…
 */
export default function GroupBuyDetailScreen() {
  const { id = "", name } = useLocalSearchParams<{ id?: string; name?: string }>();
  const brand = useAdminBrand();
  const dashboard = useGroupBuyDashboard(id);
  const currency = typeof brand.data?.currency === "string" && brand.data.currency ? brand.data.currency : "₱";

  return (
    <>
      <Stack.Screen options={{ title: dashboard.data?.analytics.overview.name ?? name ?? "Group buy" }} />
      {dashboard.data ? (
        <RoundDashboard
          data={dashboard.data}
          currency={currency}
          refreshing={dashboard.isRefetching}
          onRefresh={() => void dashboard.refetch()}
        />
      ) : dashboard.isError || !id ? (
        <ErrorState message={dashboard.error?.message ?? "This group buy couldn't be found."} onRetry={id ? () => void dashboard.refetch() : undefined} />
      ) : (
        <SkeletonList rows={5} />
      )}
    </>
  );
}
