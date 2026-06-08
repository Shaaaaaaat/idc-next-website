import "server-only";

type TenantMap = Record<string, string>;

export type LkTenant = {
  id: string;
  host: string;
};

function pickHost(req: Request): string {
  const headers = new Headers(req.headers);
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = headers.get("host")?.split(",")[0]?.trim();
  return String(forwardedHost || host || "").toLowerCase();
}

function parseTenantMap(raw: string | undefined): TenantMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([host, tenant]) => Boolean(host) && typeof tenant === "string")
        .map(([host, tenant]) => [host.toLowerCase(), String(tenant).trim()])
    );
  } catch {
    return {};
  }
}

export function resolveLkTenant(req: Request): LkTenant {
  const host = pickHost(req);
  const map = parseTenantMap(process.env.LK_TENANT_MAP);
  const fallback = String(process.env.LK_DEFAULT_TENANT || "default").trim() || "default";
  const tenantId = map[host] || fallback;

  return {
    id: tenantId,
    host,
  };
}

