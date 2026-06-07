// Public image upload for the self-serve onboarding wizard (jonina.store/get-started).
//
// A Route Handler — NOT a server action — on purpose: server actions are capped
// at next.config's `serverActions.bodySizeLimit` (2 MB), which a logo or product
// photo blows past. Route handlers have no such cap. No auth: there is no tenant
// yet during onboarding. Files land in the shared ImageKit `/onboarding` folder;
// when ImageKit isn't configured (or in demo), bytes round-trip as a data URL so
// the wizard still works locally. Only image URLs travel in the final submit
// payload, keeping that action well under its 2 MB limit.

import { NextRequest, NextResponse } from "next/server";
import { uploadOnboardingMedia } from "@/lib/imagekit/server";
import { isDemoMode } from "@/lib/demo/fixtures";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB

const KINDS = new Set(["logo", "banner", "inspiration", "product", "payment-qr", "proof"]);

/** Whether real ImageKit credentials are present (not blank / not placeholders). */
function imageKitConfigured(): boolean {
  const bad = (v?: string) => !v || v.trim() === "" || v.toLowerCase().includes("placeholder");
  return (
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY) &&
    !bad(process.env.IMAGEKIT_PRIVATE_KEY) &&
    !bad(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT)
  );
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = form.get("file");
  const kindRaw = String(form.get("kind") || "logo");
  const kind = KINDS.has(kindRaw) ? kindRaw : "logo";

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large (max 6 MB)." }, { status: 413 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: `Unsupported type: ${file.type || "unknown"}.` }, { status: 415 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Demo, or ImageKit not configured → inline so the wizard still works.
  if (isDemoMode() || !imageKitConfigured()) {
    return NextResponse.json({ url: `data:${file.type};base64,${bytes.toString("base64")}` });
  }

  try {
    const uploaded = await uploadOnboardingMedia({
      file: bytes,
      fileName: `${kind}-${file.name || "image"}`,
      tags: ["onboarding", kind],
    });
    return NextResponse.json({ url: uploaded.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 502 },
    );
  }
}
