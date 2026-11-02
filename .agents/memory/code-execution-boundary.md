---
name: Browser code execution boundary
description: Security and language-scope constraints for the Nexo code workspace.
---

Run generated Python and JavaScript only in an opaque-origin browser sandbox without application credentials. HTML previews must not be granted same-origin access. Do not add an endpoint that executes generated code in the application server.

**Why:** The app server holds provider credentials; allowing arbitrary generated code there would expose them and the project filesystem. Browser execution also keeps the supported scientific Python packages separate from server dependencies.

**How to apply:** Preserve cancellation, execution/output limits, isolated workers and explicit errors. Supporting server-dependent or compiled languages requires a separate safely isolated execution service, not a host-process shortcut.
