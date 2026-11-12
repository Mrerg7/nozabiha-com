/**
 * Edge Worker: canonical host + indexing hygiene for nozabiha.com.
 *
 * Fixes Google Search Console "Page with redirect":
 *  - Same-host /index.html and /index aliases serve 200 with an apex
 *    canonical Link header (not 301), so GSC stops excluding them.
 *  - www / http collapse to https://nozabiha.com in one permanent hop.
 *  - Unknown paths return a real 404 immediately — never a trailing-slash
 *    redirect into a missing page (redirect → 404 chains pollute GSC).
 *  - Leftover Assets 307/302 responses are promoted to absolute 301s.
 *  - /sitemap.xml is served at 200 (rewrite to sitemap-index.xml).
 */
interface Env {
  ASSETS: Fetcher;
}

const CANONICAL_HOST = "nozabiha.com";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "SAMEORIGIN",
};

function collapseSlashes(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  return collapsed === "" ? "/" : collapsed;
}

function isHomeAlias(pathname: string): boolean {
  const path = collapseSlashes(pathname);
  return path === "/" || /^\/index(\.html)?\/?$/i.test(path);
}

function isNotFoundPath(pathname: string): boolean {
  const path = collapseSlashes(pathname);
  return /^\/404(\.html)?\/?$/i.test(path);
}

/** Collapse /index.html (and /index) onto the directory URL. */
function directoryPath(pathname: string): string {
  let path = collapseSlashes(pathname);
  if (/^\/index(\.html)?\/?$/i.test(path)) return "/";
  if (/\/index\.html\/?$/i.test(path)) {
    path = path.replace(/index\.html\/?$/i, "");
    return path === "" ? "/" : path;
  }
  if (/\/index\/?$/i.test(path)) {
    path = path.replace(/index\/?$/i, "");
    return path === "" ? "/" : path;
  }
  return path;
}

function absoluteCanonical(pathname: string, search = ""): string {
  return `${CANONICAL_ORIGIN}${directoryPath(pathname)}${search}`;
}

function permanentRedirect(location: string): Response {
  // Always emit an absolute HTTPS apex URL. Some local runtimes rewrite a
  // Location that matches the inbound scheme; force https in the string.
  const httpsLocation = location.replace(/^http:\/\//i, "https://");
  return new Response(null, {
    status: 301,
    headers: {
      Location: httpsLocation,
      "Cache-Control": "public, max-age=3600",
      ...SECURITY_HEADERS,
    },
  });
}

async function notFoundResponse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Assets serves the custom 404 document at /404/ (force-trailing-slash).
  // Fetch that path for the body, then force a real 404 + noindex — never
  // leak a Location header that would look like another redirect to GSC.
  const assetResponse = await env.ASSETS.fetch(
    new Request(new URL("/404/", url.origin), request),
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cache-Control", "no-store");
  return new Response(assetResponse.body, {
    status: 404,
    statusText: "Not Found",
    headers,
  });
}

function withHomeCanonical(page: Response): Response {
  const headers = new Headers(page.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("Link", `<${CANONICAL_ORIGIN}/>; rel="canonical"`);
  return new Response(page.body, {
    status: 200,
    statusText: "OK",
    headers,
  });
}

function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  if (response.status === 404) {
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = (request.headers.get("host") ?? url.hostname)
      .split(":")[0]
      .toLowerCase();

    if (LOCAL_HOSTS.has(host)) {
      return env.ASSETS.fetch(request);
    }

    const proto = (
      request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")
    ).toLowerCase();

    // Real 404 for the error document — never a redirect or soft-200.
    if (isNotFoundPath(url.pathname)) {
      return notFoundResponse(request, env);
    }

    // Off-host (http / www / workers.dev): one-hop 301 to the apex canonical.
    if (proto === "http" || host !== CANONICAL_HOST) {
      return permanentRedirect(absoluteCanonical(url.pathname, url.search));
    }

    // Homepage aliases: serve at 200 with apex canonical so GSC does not
    // report same-host /index.html as "Page with redirect".
    if (isHomeAlias(url.pathname)) {
      const page = await env.ASSETS.fetch(new URL("/", url.origin).toString());
      if (
        page.status === 301 ||
        page.status === 302 ||
        page.status === 307 ||
        page.status === 308
      ) {
        return permanentRedirect(`${CANONICAL_ORIGIN}/`);
      }
      if (page.status >= 400) {
        return harden(page);
      }
      return withHomeCanonical(page);
    }

    // Crawler convenience URL — 200 rewrite, no redirect chain.
    if (url.pathname === "/sitemap.xml" || url.pathname === "/sitemap.xml/") {
      return env.ASSETS.fetch(new URL("/sitemap-index.xml", url.origin).toString());
    }

    // Single-page site: any other path is a real 404. Do not add a trailing
    // slash first — that creates a redirect → 404 chain Search Console flags.
    if (url.pathname !== "/" && !/\.\w+$/.test(url.pathname)) {
      return notFoundResponse(request, env);
    }

    const assetResponse = await env.ASSETS.fetch(request);

    // Promote leftover temporary asset redirects to permanent apex 301s.
    if (
      assetResponse.status === 301 ||
      assetResponse.status === 302 ||
      assetResponse.status === 307 ||
      assetResponse.status === 308
    ) {
      const location = assetResponse.headers.get("Location");
      if (location) {
        const dest = new URL(location, CANONICAL_ORIGIN);
        return permanentRedirect(absoluteCanonical(dest.pathname, dest.search));
      }
    }

    if (assetResponse.status === 404) {
      return notFoundResponse(request, env);
    }

    return harden(assetResponse);
  },
} satisfies ExportedHandler<Env>;
