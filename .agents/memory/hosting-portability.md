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
