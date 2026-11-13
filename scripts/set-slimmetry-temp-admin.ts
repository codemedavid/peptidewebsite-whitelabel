import { prisma } from "../src/lib/db/prisma";
import { hashPassword } from "../src/lib/auth/password-hash";
async function main() {
  const email = "admin@slimmetry.store";
  const password = "SlimmetryDemo#2026";
  await prisma.tenant.update({
    where: { slug: "slimmetry" },
    data: { storeAdminEmail: email, storeAdminPasswordHash: hashPassword(password) },
  });
  console.log(`✓ temp admin set — email: ${email}  password: ${password}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
