# Deploy Nexo AI to Vercel

This repository now supports **one Vercel project** for both the static React
frontend and the streaming Express API. No UI changes or Next.js migration are
needed. The existing Replit workflows remain supported.

## 1. Push the repository to GitHub

Push the whole repository, not just `artifacts/ai-chat`. Keep `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `lib/`, `artifacts/`, `api/`, and `vercel.json`.
Do not commit secrets, `.env` files, `node_modules`, or generated `dist` files.

## 2. Import it into Vercel

Choose **Add New → Project**, import the GitHub repository, and use:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`), not an artifact subfolder |
| Framework Preset | Other |
| Node.js Version | 24.x (also pinned in root `package.json`) |
| Install Command | `npx --yes pnpm@10.26.1 install --frozen-lockfile` |
| Build Command | `npx --yes pnpm@10.26.1 run build:vercel` |
| Output Directory | `artifacts/ai-chat/dist/public` |

The root `vercel.json` supplies the commands, output directory, routes, Fluid
compute, cancellation support, and a 180-second function duration. Use a Vercel
plan/configuration that supports that duration. A shorter maximum can interrupt
long Deepthink responses. No separate API project or cross-origin API URL is needed.
The commands explicitly select pnpm 10 because Vercel's overridden bare `pnpm`
install command can otherwise select an older version without workspace catalogs.

## 3. Configure server-side environment variables

Add these through **Vercel → Project → Settings → Environment Variables**:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | All model inference, including Deepthink and fallback models |
| `FIRECRAWL_API_KEY` | Optional, recommended for reliable search | Direct Firecrawl access, independent of the Replit connector |
| `LOG_LEVEL` | Optional | Defaults to `info` |

Enable the keys for Production and, if desired, Preview. Replit secrets are not
automatically copied. Enter credentials directly into Vercel, never in source
code, GitHub, or chat. Never prefix these keys with `VITE_`: that exposes them to
the browser. No OpenAI key or Replit AI billing configuration is used.

Without a Firecrawl key, Vercel skips the Replit connector and uses the existing
public scraper. Public sites/search engines can block scraping, so successful
web retrieval is not guaranteed. Retrieval failures remain visible to the user.
Replit can continue using its connector when no direct Firecrawl key is set.

No database or session secret is required by the current chat routes. History
stays in browser localStorage. The Vercel domain has separate storage from the
Replit domain: existing chats do not transfer automatically.

## 4. Deploy and verify

Click Deploy in Vercel. After it finishes:

1. Open `/api/healthz`: it should return `{"status":"ok"}`.
   This checks routing/runtime, not the validity of the Groq key.
2. Send a short chat and verify streamed output.
3. Turn on Deepthink and verify a response.
4. Ask a current-events question to verify retrieval.
5. Stop a streaming answer, refresh, and check that history is retained.
6. Check Function logs if anything fails. Updating environment variables
   requires a new deployment before existing deployments pick them up.

`api/index.mjs` imports the bundled Express app without opening a listening port.
API routes are processed before static assets and the SPA fallback, so unknown
API routes return API 404s rather than HTML.

## Public-access caution

Nexo currently has no sign-in or durable per-user quota protection. Anyone able
to reach the public chat endpoint can consume the server owner's Groq/search
allowances. For personal use, restrict access with available Vercel deployment
protection; before broad public sharing, add authentication and durable rate
limits. In-memory search caches and model cooldowns are best-effort per function
instance, not shared or persistent across Vercel instances.

## Local build verification

From the repository root:

```sh
pnpm install --frozen-lockfile
NODE_ENV=production pnpm run build:vercel
pnpm --filter @workspace/api-server run test
pnpm check:vercel
```

This builds but does not publish. Vercel's cloud packaging, domain routing,
provider credentials, and streaming must still be checked after deployment.
