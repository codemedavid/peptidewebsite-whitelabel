import { NextResponse } from "next/server";
import { resolveAndroidDownload } from "@/marketing/app-download";

// Stable, shareable short link (pepweb.store/download/android) for the current
// APK. The binary's real home can move (EAS artifact → self-hosted) without
// breaking links already posted in chats.
export const dynamic = "force-dynamic";

export function GET() {
  const { apkUrl } = resolveAndroidDownload();
  // Relative Location: req.url is the internal rewritten URL here, not the apex host.
  if (!apkUrl) return new Response(null, { status: 302, headers: { Location: "/download" } });
  return NextResponse.redirect(apkUrl, 302);
}
