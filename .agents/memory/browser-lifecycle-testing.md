---
name: Browser lifecycle testing
description: Chromium lifecycle controls available in the project's browser test harness.
---

The bundled Chromium does not support `Emulation.setPageVisibilityState`. To test a suspended tab, use CDP `Page.setWebLifecycleState` with `frozen` and `active`, and make changes from a separate live tab while the target is frozen.

**Why:** Visibility emulation failed in this environment, while the lifecycle freeze/resume control is available and reproduces a suspended page receiving queued cross-tab updates.

**How to apply:** Keep the app tabs same-origin, schedule the source-tab changes before freezing, and assert persisted values and receiver behavior after resuming.
