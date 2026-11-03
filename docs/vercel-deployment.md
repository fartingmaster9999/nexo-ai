# Deploy Nexo AI to Vercel

This repository uses **Vercel Services**: one Vercel project, one website address,
and three independently built services. No UI changes or Next.js migration are
needed. The existing Replit workflows remain supported.

| Service | Public path | Purpose |
| --- | --- | --- |
| `ai-chat` | `/` and all non-API paths | Chat interface, assets, and browser code runner |
| `api-server` | `/api` and `/api/*` | Streaming Groq chat and selective web retrieval |
| `mockup-sandbox` | None; internal only | Component-preview service |

The chat stays at the domain root. The sandbox is included as a service but has
no public rewrite or binding, so the development preview tool is not exposed.

## 1. Push the repository to GitHub

Push the whole repository, not just `artifacts/ai-chat`. Keep `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `lib/`, `artifacts/`, and `vercel.json`.
Do not commit secrets, `.env` files, `node_modules`, or generated `dist` files.

## 2. Import it into Vercel

Choose **Add New → Project**, import the GitHub repository, and use:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`), not an artifact subfolder |
| Framework Preset | Allow detection from the root `vercel.json` |
| Node.js Version | 24.x (also pinned in root `package.json`) |
| Project-level Install/Build/Output overrides | Leave unset; each service owns these settings |

The root `vercel.json` supplies the per-service commands, output directory,
entry point, cancellation support, public rewrites and a 180-second API function
duration. Use a Vercel plan/configuration that supports that duration. A shorter
maximum can interrupt long Deepthink responses. No separate API project or
cross-origin API URL is needed. Remove old project-level build or output
overrides from the earlier single-function setup before redeploying.

All services install the workspace from the repository root using pinned pnpm
10, with development dependencies enabled for build tools. Vite builds into
`artifacts/ai-chat/dist/public` and `artifacts/mockup-sandbox/dist`. Vercel compiles the Express entry point
`artifacts/api-server/src/index.ts` as the Express serverless handler. It only
starts a standalone listener when `PORT` is supplied, preserving Replit's server
workflow without requiring a port in Vercel Functions. The API build script also
produces the standalone server bundle used by Replit.
The `.vercelignore` file excludes Replit's local tooling, caches, dependencies,
and generated outputs from upload and local Vercel file discovery.

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

The API service exports Express without opening a listening port. Replit still
uses `src/index.ts` to start its standalone server.

Top-level rewrites route `/api` and `/api/*` to `api-server`, then all remaining
paths to `ai-chat`. The API keeps its original request path, so `/api/chat`
reaches the Express route unchanged. Unknown API paths return API 404s, not
frontend HTML. The frontend uses Vercel's default Vite file routing: its homepage,
scripts, images, and browser code runner are served directly. No catch-all HTML
rewrite intercepts asset requests. The app only has a homepage route; nonexistent
paths can return the hosting platform's normal 404.

### Why there are no private bindings

The Vite frontend is static code running in the visitor's browser. It calls the
public same-origin `/api/chat` endpoint. Neither service calls the other from a
server function, so no internal bindings are needed. Bindings only resolve inside
functions at runtime; do not expose a private bound URL through `VITE_` variables
or try to use it in the browser/build. Groq and Firecrawl are external providers,
not other services in this project.

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

These commands build all three services and exercise the actual
Express source entry point with provider credentials disabled. They do not publish.

For a full local Services routing check, use the current Vercel CLI:

```sh
vercel dev --local
```

`--local` runs without Vercel cloud authentication (`-L` is the older alias).
Visit the address it prints; verify `/`, `/api/healthz`, `/api/chat`, and that
the logo, scripts, and code-runner assets have the correct content types.
Without `-L`, `vercel dev` uses your linked Vercel project. No binding variables
need to be supplied manually. Vite defaults to `/` and port 5173 if the local
runner does not supply Replit's `BASE_PATH`/`PORT`.

Vercel's cloud packaging, provider credentials, and streaming still need a check
after deployment. Services documentation: https://vercel.com/docs/services.
