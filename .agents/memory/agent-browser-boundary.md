---
name: Agent browser boundary
description: Security and product boundary for browser automation in Nexo Agent.
---

Nexo Agent browser checks may interact only with the generated project’s isolated local preview. Use bounded, declarative actions and return sanitized step results; do not browse arbitrary external sites, use authenticated browser sessions, access credentials, or send page text to the parent app or model.

**Why:** This gives Agent a useful build-and-repair loop without turning it into a general browser automation tool that could expose private pages or user sessions.

**How to apply:** Keep tests inside the opaque-origin preview with network access disabled. Add only allowlisted actions and fixed-size results; require a separate, explicit product and security review before expanding beyond generated previews.
