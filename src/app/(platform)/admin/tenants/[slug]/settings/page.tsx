import { notFound } from "next/navigation";
import { getTenantOrderFormat, getTenantContactChannels } from "@/lib/admin/data";
import { TenantSettingsView } from "@/components/admin/TenantSettingsView";

export const dynamic = "force-dynamic";

const ROOT = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "peptide.app").replace(/:\d+$/, "");

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [tenant, contact] = await Promise.all([
    getTenantOrderFormat(slug),
    getTenantContactChannels(slug),
  ]);
  if (!tenant || !contact) notFound();

  return (
    <TenantSettingsView
      slug={slug}
      name={tenant.name}
      domain={`${slug}.${ROOT}`}
      format={tenant.format}
      initialChannels={contact.contactChannels}
      initialCheckoutTitle={contact.checkoutTitle}
      initialCheckoutNote={contact.checkoutNote}
    />
  );
}
