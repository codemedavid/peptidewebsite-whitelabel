import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { pgAdapterSchema, pgPoolConfig } from "./pool-config";

// Queries run through node-postgres (one round trip per statement) instead of
// Prisma's engine (~5 per statement over the pooler) — see pool-config.ts.
function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(pgPoolConfig(process.env), { schema: pgAdapterSchema(process.env) }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Singleton — avoid exhausting the connection pool during dev hot-reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
