import { NextRequest, NextResponse } from "next/server";

function hasFileExtension(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname);
}

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  // Внутренние https/www редиректы отключены. Их реализуем через next.config redirects()
  // и/или на внешнем уровне (API Gateway). Здесь оставляем только нормализацию слэша.

  // Trim trailing slash, excluding root, API and assets/files
  const { pathname, search } = url;
  const isRoot = pathname === "/";
  const isApi = pathname.startsWith("/api");
  const isNextAsset = pathname.startsWith("/_next");
  const isAsset = hasFileExtension(pathname);

  if (!isRoot && !isApi && !isNextAsset && !isAsset && pathname.endsWith("/")) {
    const newPath = pathname.replace(/\/+$/, "");
    // Use relative redirect to avoid platform injecting :8080 into absolute Location
    return NextResponse.redirect(`${newPath}${search}`, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};

