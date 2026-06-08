import { NextResponse } from "next/server";
import { consumeMagicLink, getAuthCookieConfig } from "@/lib/auth/lkAuth";
import { getPublicSiteOrigin } from "@/lib/siteOrigin";
import { resolveLkTenant } from "@/lib/lk/tenant";

function isSessionTokenPayload(data: unknown): data is { ok: true; session_token: string } {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  return rec.ok === true && typeof rec.session_token === "string" && rec.session_token.length > 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = String(url.searchParams.get("token") || "").trim();
  const site = getPublicSiteOrigin(req);

  if (!token) {
    return NextResponse.redirect(new URL("/lk/verify?invalid=1", site), 303);
  }

  const consumeRes = await consumeMagicLink(token);
  if (!consumeRes.ok || !isSessionTokenPayload(consumeRes.data)) {
    const tenant = resolveLkTenant(req);
    const err =
      consumeRes.ok || consumeRes.reason !== "auth_failed"
        ? "invalid"
        : "expired";
    return NextResponse.redirect(new URL(`/lk/verify?${err}=1&t=${encodeURIComponent(tenant.id)}`, site), 303);
  }

  const res = NextResponse.redirect(new URL("/lk", site), 303);
  const cookie = getAuthCookieConfig();
  res.cookies.set({
    name: cookie.name,
    value: consumeRes.data.session_token,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
    domain: cookie.domain,
  });
  return res;
}

