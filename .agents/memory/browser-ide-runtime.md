---
name: Warm browser runtime
description: Performance and isolation expectations for Nexo's in-browser code runner.
---

The browser runner may keep its Python runtime and imported-package cache warm between executions, but each snippet must receive fresh Python globals. Load packages only when current code imports them. Keep execution inside the opaque-origin sandbox, and terminate/recreate the worker after cancellation or timeout.

**Why:** Starting the Python runtime costs several seconds, while fresh globals preserve independent snippets and runtime reuse makes later runs responsive.

**How to apply:** Future speed work must preserve browser-only execution, fresh snippet variables, on-demand imports, and cancellation/recovery tests. Never move untrusted code into the app server or preload every language and package.
