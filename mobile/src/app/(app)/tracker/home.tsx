import { router } from "expo-router";
import { TrackerHome } from "@/features/tracker/components/TrackerHome";

/**
 * The store team's own Peptide Tracker (More → Peptide Tracker). Same home as
 * the customers' tab, full screen with a back button: the owner and each staff
 * member keep a private tracker of their own — never anyone else's.
 */
export default function TeamTrackerScreen() {
  return <TrackerHome onBack={() => (router.canGoBack() ? router.back() : router.replace("/more"))} />;
}
