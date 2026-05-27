import { type NextRequest, type NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Edge-safe Supabase session refresh. AUTH ONLY — no Prisma (can't run on the
 * Edge runtime). Validates the access token and, when Supabase rotates tokens,
 * writes the refreshed cookies onto BOTH the forwarded request (so this request's
 * Server Components read the new token) and the response (so the browser stores it).
 *
 * `requestHeaders` is the header set the middleware forwards downstream; we keep
 * its `cookie` header in sync as tokens rotate. `rebuild` recreates the response
 * (rewrite or next) so the refreshed cookies ride along.
 */
export async function refreshSupabaseSession(
  req: NextRequest,
  requestHeaders: Headers,
  rebuild: () => NextResponse,
): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let res = rebuild();
  if (!url || !anon) return res;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        requestHeaders.set(
          "cookie",
          req.cookies.getAll().map((c) => `${c.name}=${c.value}`).join("; "),
        );
        res = rebuild();
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  try {
    // Touching getUser() is what triggers the refresh-cookie write above.
    await supabase.auth.getUser();
  } catch {
    // Network/auth hiccup must never break host routing — fall through.
  }
  return res;
}
