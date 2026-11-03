---
name: Hosting portability
description: Independent Vercel hosting should remain compatible with the Replit development environment.
---

Support independent hosting in the user's Vercel account without replacing the
existing Replit development setup or changing the UI.

**Why:** The user asked to configure Nexo for deployment outside Replit after
requesting instructions for hosting it in their own Vercel account.

**How to apply:** Keep model inference exclusively on Groq. Treat Replit-managed
connections as optional outside Replit; direct provider credentials must remain
server-only. Prefer same-origin chat routing so deployment does not introduce
cross-origin browser credential handling. Preserve the standalone server entry
point alongside the serverless entry point.

Include all three discovered services in the Vercel project, but expose only the
chatbot at `/` and API at `/api`. Keep the design sandbox internal unless the
user explicitly asks to publish that development tool.

**Why:** The user's later supplied configuration includes the mockup sandbox as
a service. Their goal is browser access to the actual chatbot, not public access
to development tools.

**How to apply:** Runtime-only Vercel bindings belong to actual server-to-server
callers, not a static Vite SPA. The browser calls the same-origin public API;
declaring a service does not require exposing it through a public rewrite.

Keep Replit-only caches and tooling excluded through `.vercelignore`, not only
`.gitignore`.

**Why:** Vercel's local Services scanner included the workspace's large ignored
pnpm/tooling caches as static build matches, stalling the combined router even
though the individual service servers were healthy.

**How to apply:** Retain explicit exclusions for local tooling/cache directories
when adjusting Vercel packaging; do not upload them or treat them as services.

Validate frontend asset content types through the combined Vercel router, not
just HTTP status codes or nonempty responses.

**Why:** A service-level HTML fallback returned successful HTML responses for
JavaScript, PNG, and code-runner requests. Status-only checks missed the broken
asset routing. The current app only needs a homepage, so forcing an SPA fallback
adds no useful route coverage.

**How to apply:** Preserve normal Vite file routing unless real client routes
require a fallback. Check actual JavaScript and image content types whenever
changing Vercel rewrites or service-level routing.

For the Express service, keep the conventional `src/index.ts` entrypoint
compatible with both Vercel Functions and Replit: default-export the app, and
only start a listener when a standalone `PORT` is supplied.

**Why:** Vercel's Express runtime loads `src/index.ts` as a handler without
setting `PORT`; treating that as fatal caused production requests to fail before
they reached chat or Groq. Replit still needs the same file to bind its port.

**How to apply:** Keep the Vercel entrypoint and per-function settings aligned
with `src/index.ts`. Test its import with `VERCEL=1` and no `PORT`, as well as
the normal Replit workflow with `PORT`.
