interface Env {
  ASSETS: Fetcher;
}

const CANONICAL_ORIGIN = "https://nozabiha.com";
const CANONICAL_HOST = "nozabiha.com";
const NOT_FOUND_PATHS = new Set(["/404", "/404/", "/404.html"]);

function getCanonicalRedirect(request: Request): string | null {
  const url = new URL(request.url);
  const canonical = new URL(url.pathname + url.search, CANONICAL_ORIGIN);
  let needsRedirect = false;

  if (url.hostname === CANONICAL_HOST || url.hostname === `www.${CANONICAL_HOST}`) {
    if (url.protocol === "http:" || url.hostname === `www.${CANONICAL_HOST}`) {
      needsRedirect = true;
    }
  }

  if (canonical.pathname === "/index.html" || canonical.pathname === "/index.html/") {
    canonical.pathname = "/";
    needsRedirect = true;
  }

  if (
    !NOT_FOUND_PATHS.has(canonical.pathname) &&
    canonical.pathname !== "/" &&
    !canonical.pathname.endsWith("/") &&
    !/\.\w+$/.test(canonical.pathname)
  ) {
    canonical.pathname += "/";
    needsRedirect = true;
  }

  return needsRedirect ? canonical.toString() : null;
}

async function notFoundResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(new URL("/404.html", url.origin), request));
  return new Response(assetResponse.body, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (NOT_FOUND_PATHS.has(url.pathname)) return notFoundResponse(request, env);
    const redirectUrl = getCanonicalRedirect(request);
    if (redirectUrl) return Response.redirect(redirectUrl, 301);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
