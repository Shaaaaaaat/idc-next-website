const DEFAULT_CUSTOMER_DOMAIN = "customer-mzjp8mklh35mmlo3.cloudflarestream.com";

function normalizeHostname(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function isAllowedCloudflareVideoHost(hostname: string) {
  const host = normalizeHostname(hostname);

  return (
    host === DEFAULT_CUSTOMER_DOMAIN ||
    host === "videodelivery.net" ||
    host === "iframe.videodelivery.net" ||
    (host.startsWith("customer-") && host.endsWith(".cloudflarestream.com"))
  );
}

export function isCloudflareStreamUid(raw: unknown): raw is string {
  const value = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{20,64}$/.test(value);
}

export function resolveCloudflareIframeUrl(rawUrl: unknown, videoAssetId: unknown): string {
  const expectedUid = String(videoAssetId || "").trim();
  if (!isCloudflareStreamUid(expectedUid)) return "";

  try {
    const url = new URL(String(rawUrl || "").trim());
    if (url.protocol !== "https:" || !isAllowedCloudflareVideoHost(url.hostname)) return "";

    const encodedUid = encodeURIComponent(expectedUid);
    const iframePath = `/${encodedUid}/iframe`;
    if (url.pathname === iframePath) return url.toString();

    if (url.pathname !== `/${encodedUid}/watch`) return "";
    url.pathname = iframePath;
    return url.toString();
  } catch {
    return "";
  }
}
