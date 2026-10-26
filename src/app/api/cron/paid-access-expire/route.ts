import { NextResponse } from "next/server";
import { expireStaleEverywhere } from "@/modules/paid-access";

// Paid Access payment-window sweep for every store (src/modules/paid-access/server/sweep.ts).
// Optional: joins and payments already settle lapsed holds themselves — this
// frees slots for waitlists without waiting for the next visitor.
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await expireStaleEverywhere()) });
}
