import { NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/auth/lkAuth";
import { getPublicSiteOrigin } from "@/lib/siteOrigin";
import { resolveLkTenant } from "@/lib/lk/tenant";

export async function POST(req: Request) {
  const tenant = resolveLkTenant(req);
  try {
    const formData = await req.formData();
    const emailRaw = formData.get("email");
    const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";

    // UX requirement: always return neutral success state.
    if (email) {
      await requestMagicLink(email);
    }
  } catch {
    // Do not leak backend errors to user.
  }

  const redirectUrl = new URL(
    `/lk/login?sent=1&t=${encodeURIComponent(tenant.id)}`,
    getPublicSiteOrigin(req)
  );
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

