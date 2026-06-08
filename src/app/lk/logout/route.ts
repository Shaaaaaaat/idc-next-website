import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthCookieConfig, revokeSession } from "@/lib/auth/lkAuth";
import { getPublicSiteOrigin } from "@/lib/siteOrigin";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const cookie = getAuthCookieConfig();
  const cookieName = cookie.name;
  const sessionToken = cookieStore.get(cookieName)?.value || "";

  if (sessionToken) {
    await revokeSession(sessionToken);
  }

  cookieStore.set({
    name: cookie.name,
    value: "",
    path: cookie.path,
    domain: cookie.domain,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    maxAge: 0,
  });
  return NextResponse.redirect(new URL("/lk/login", getPublicSiteOrigin(req)), 303);
}

