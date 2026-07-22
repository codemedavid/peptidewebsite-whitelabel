import { requirePlatformUser } from "@/lib/auth/session";
import { getIncomeAnalytics } from "@/lib/admin/income-data";
import { IncomeView } from "@/components/admin/pages/IncomeView";

export const dynamic = "force-dynamic";

export default async function IncomePage() {
  await requirePlatformUser();
  const data = await getIncomeAnalytics();
  return <IncomeView data={data} />;
}
