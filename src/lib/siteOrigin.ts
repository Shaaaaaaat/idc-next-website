import "server-only";

function tryParseOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * Public origin for absolute redirects (email magic link, POST→GET redirects).
 * In Docker / behind LB set SITE_URL or NEXT_PUBLIC_SITE_URL (e.g. https://calisthenics.ru).
 */
export function getPublicSiteOrigin(req: Request): string {
  const fromEnv =
    process.env.SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");

  const envOrigin = fromEnv ? tryParseOrigin(fromEnv) : null;
  if (envOrigin) return envOrigin;

  const h = new Headers(req.headers);
  const xfHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  const xfProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (xfHost) {
    const proto = xfProto === "http" || xfProto === "https" ? xfProto : "https";
    const forwarded = tryParseOrigin(`${proto}://${xfHost}`);
    if (forwarded) return forwarded;
  }

  return new URL(req.url).origin;
}
