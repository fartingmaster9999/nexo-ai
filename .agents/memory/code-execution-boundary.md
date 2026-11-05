---
name: Browser code execution boundary
description: Security, language scope, and on-demand dependency rules for the Nexo code workspace.
---

Run generated Python and JavaScript only in an opaque-origin browser sandbox without application credentials. HTML previews must not be granted same-origin access. Do not add an endpoint that executes generated code in the application server.

**Why:** The app server holds provider credentials; allowing arbitrary generated code there would expose them and the project filesystem. Browser execution also keeps the supported scientific Python packages separate from server dependencies.

**How to apply:** Preserve cancellation, execution/output limits, isolated workers and explicit errors. Supporting server-dependent or compiled languages requires a separate safely isolated execution service, not a host-process shortcut.

Load only the editor language in use and Python packages needed by the executed code, rather than preloading all language modes or scientific packages.

**Why:** The user explicitly requested not to load every language or every Python library. Earlier requests to make scientific libraries available do not mean they should all be downloaded and imported on each run.

**How to apply:** Keep supported packages available on demand, require accurate imports in generated examples, and avoid claiming scientific aliases are preloaded.
