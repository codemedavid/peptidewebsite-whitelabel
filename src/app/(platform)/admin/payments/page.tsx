import { requirePlatformUser } from "@/lib/auth/session";
import { getPackagePayment } from "@/lib/platform/package-payment-server";
import { PackagePaymentManager } from "@/components/admin/pages/PackagePaymentManager";

export const dynamic = "force-dynamic";

export default async function CheckoutPaymentsPage() {
  await requirePlatformUser();
  const config = await getPackagePayment();
  return <PackagePaymentManager initial={config} />;
}
