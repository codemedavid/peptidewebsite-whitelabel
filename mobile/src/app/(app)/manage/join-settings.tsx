import { Stack, useLocalSearchParams } from "expo-router";
import { useAdminBrand } from "@/features/admin/setup/data";
import { Loadable } from "@/features/admin/setup/ui";
import { usePaidAccessSettings } from "@/features/admin/group-buys/paid-access/hooks";
import { SettingsEditor } from "@/features/admin/group-buys/paid-access/SettingsEditor";
import { EmptyState, ErrorState } from "@/ui/feedback";

/**
 * One round's Paid Access Join settings (getPaidAccessSettingsAction /
 * savePaidAccessSettingsAction), opened from Join requests:
 * /manage/join-settings?id=…&name=…
 */
export default function JoinSettingsScreen() {
  const { id = "", name } = useLocalSearchParams<{ id?: string; name?: string }>();
  const brand = useAdminBrand();
  const settings = usePaidAccessSettings(id);
  const currency = typeof brand.data?.currency === "string" && brand.data.currency ? brand.data.currency : "₱";

  return (
    <>
      <Stack.Screen options={{ title: name ? `Join · ${name}` : "Join settings" }} />
      {!id ? (
        <ErrorState message="This group buy couldn't be found." />
      ) : (
        <Loadable query={settings}>
          {(view) =>
            view.enabled ? (
              // Keyed on the version so a save elsewhere re-seeds the form.
              <SettingsEditor key={`${id}:${view.version}`} groupBuyId={id} view={view} currency={currency} />
            ) : (
              <EmptyState
                icon="lock-closed-outline"
                title="Join settings aren't available"
                body="Your provider hasn't switched paid / approved group-buy access on for this store yet."
              />
            )
          }
        </Loadable>
      )}
    </>
  );
}
