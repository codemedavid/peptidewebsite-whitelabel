import { MembersScreen } from "@/features/community/components/MembersScreen";
import { BusinessSwitch } from "@/features/community/components/ViewSwitch";

/** Community view: approve, reject or revoke members. */
export default function CommunityViewMembers() {
  return <MembersScreen asTab headerRight={<BusinessSwitch />} />;
}
