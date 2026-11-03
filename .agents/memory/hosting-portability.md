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

Deploy only the chatbot and API to Vercel, not the design sandbox. Keep one public
website address and do not add private bindings for browser-to-API calls.

**Why:** The user confirmed the chatbot/public-API arrangement and sandbox
exclusion, explaining they simply want to access and use it in a web browser.

**How to apply:** Runtime-only Vercel bindings belong to actual server-to-server
callers, not a static Vite SPA. Do not add a server proxy solely to create a
binding where the browser can already call the same-origin public API.
