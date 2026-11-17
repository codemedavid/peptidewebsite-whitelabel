import { useSignedIn } from "@/auth/SessionProvider";
import { GuestTracker } from "@/features/tracker/components/GuestTracker";
import { TrackerHome } from "@/features/tracker/components/TrackerHome";

/** Customer app: the Peptide Tracker tab (granted stores only — guarded in the tab layout). A guest sees the sign-up screen. */
export default function CustomerTrackerTab() {
  const { me } = useSignedIn();
  const isGuest = me.actor.kind === "customer" && me.actor.guest === true;
  return isGuest ? <GuestTracker /> : <TrackerHome />;
}
