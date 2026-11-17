---
name: Agent browser boundary
description: Security and product boundary for browser automation in Nexo Agent.
---

Nexo Agent browser checks may interact only with the generated project’s isolated local preview. Use bounded, declarative actions and return sanitized step results; do not browse arbitrary external sites, use authenticated browser sessions, access credentials, or send page text to the parent app or model.

**Why:** This gives Agent a useful build-and-repair loop without turning it into a general browser automation tool that could expose private pages or user sessions.

**How to apply:** Keep tests inside the opaque-origin preview with network access disabled. Add only allowlisted actions and fixed-size results; require a separate, explicit product and security review before expanding beyond generated previews.

When ranking parallel builds, test each draft in a separate check-only frame and reuse the selected draft’s result when promoting it. Do not rerun its interaction plan merely to make it visible.

**Why:** Local interaction checks can cause side effects inside the draft. Replaying them during promotion can duplicate those effects and misrepresent the result.

**How to apply:** Keep candidate evaluation separate from saved project state and the current preview. Preserve the passing runtime, layout, and interaction outcomes for the selected draft; generate the user-facing preview without replaying interaction checks.
