# nozabiha.com

**Active deploy repo** for the Cloudflare Worker `nozabiha-com` (custom domain `nozabiha.com`).

> The duplicate repo [`Mrerg7/nozabiha.com`](https://github.com/Mrerg7/nozabiha.com) is unused — do not push deploy changes there.

Sister site to [nozabiha.com](https://nozabiha.com/), [nozabihahalal.com](https://nozabihahalal.com/), [islamophobe.me](https://islamophobe.me/), and [industrialterrorism.com](https://industrialterrorism.com/).

Static Astro site on Cloudflare Workers static assets. Free plan.

## Deploy

```bash
npm install
npm run deploy
```

Then in the Cloudflare dashboard, attach the custom domain `nozabiha.com` to the worker `nozabiha-com`.

Workers & Pages → Create → Import this GitHub repo also works:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Output lives in `dist/` and is bound as the `ASSETS` fetcher

## Indexing / redirects

Canonical URL: `https://nozabiha.com/`.

- `www` and `http` collapse to the apex HTTPS URL in one permanent 301.
- Same-host `/index.html` and `/index` serve the homepage at **200** with an apex `Link: rel=canonical` header (not a redirect), so Search Console does not flag them as “Page with redirect”.
- Unknown paths return a real 404 immediately (no trailing-slash redirect into a missing page).
- `/sitemap.xml` rewrites to `/sitemap-index.xml` at 200.
