---
name: Validated .replit edits
description: Safe editing flow for Replit's platform-managed TOML configuration file.
---

Write the complete, valid TOML to a temporary file inside the workspace, then call `verifyAndReplaceDotReplit({ tempFilePath })`. Direct patching of `.replit` is blocked, and conflict markers make the file invalid TOML.

**Why:** Invalid `.replit` content can prevent checkpoints and break Replit-managed project configuration.

**How to apply:** Preserve existing workflow and deployment settings when removing a secret; remove the sensitive setting itself rather than deleting the entire config unless the user explicitly accepts that impact.
