import { notFound } from "next/navigation";
import {
  getTenantOrderFormat,
  getTenantContactChannels,
  getTenantAdminFee,
  getTenantStoreAdminCredential,
  getTenantPlanStatus,
  listTenantDomains,
} from "@/lib/admin/data";
import { TenantSettingsView } from "@/components/admin/TenantSettingsView";
import { DomainManager } from "@/components/admin/DomainManager";
import { PlanStatusManager } from "@/components/admin/PlanStatusManager";

export const dynamic = "force-dynamic";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [tenant, contact, adminFee, adminCredential, planStatus, domains] = await Promise.all([
    getTenantOrderFormat(slug),
    getTenantContactChannels(slug),
    getTenantAdminFee(slug),
    getTenantStoreAdminCredential(slug),
    getTenantPlanStatus(slug),
    listTenantDomains(slug),
  ]);
  if (!tenant || !contact || !adminFee) notFound();

  return (
    <TenantSettingsView
      slug={slug}
      name={tenant.name}
      domain={`${slug}.${ROOT}`}
      format={tenant.format}
      planStatus={
        planStatus ? (
          <PlanStatusManager slug={slug} planKey={planStatus.planKey} status={planStatus.status} />
        ) : null
      }
      initialChannels={contact.contactChannels}
      initialCheckoutTitle={contact.checkoutTitle}
      initialCheckoutNote={contact.checkoutNote}
      initialMetaDescription={contact.metaDescription}
      initialRequireProofOfPayment={contact.requireProofOfPayment}
      initialNoticeModalGranted={contact.noticeModalGranted}
      initialAdminFee={adminFee}
      adminFeeEntitled={adminFee.entitled}
      initialAdminEmail={adminCredential?.email ?? ""}
      initialHasAdminPassword={adminCredential?.hasPassword ?? false}
      domains={<DomainManager slug={slug} initialDomains={domains} />}
    />
  );
}
