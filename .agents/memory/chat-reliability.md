---
name: Chat reliability boundaries
description: Non-destructive history evolution, context pruning, and interrupted-stream recovery decisions.
---

Retain legacy browser history as a backup when evolving persistence; never clear it as part of an automatic migration.
**Why:** Existing conversations may be the user's only copy, and browser storage can be malformed or full. A migration must not turn a recoverable read failure into permanent loss.
**How to apply:** Preserve readable records independently, report failures, and use deletion markers so intentionally deleted legacy chats do not return.

Prune whole older turns for API context, not saved history or pieces of the newest prompt.
**Why:** Cutting code or instructions mid-message changes their meaning. Extra model calls to summarize history also consume the user's limited Groq quota.
**How to apply:** Keep the current prompt intact, bound recent context, and explicitly reject oversized new inputs rather than silently truncating them.

Keep partial replies on interruption; do not automatically regenerate a response after streaming has begun.
**Why:** A retry can duplicate output, spend additional quota, and overwrite useful partial work.
**How to apply:** Distinguish cancellation, connection failures, and actual provider quota errors. Release request resources and allow a new user-initiated message.
