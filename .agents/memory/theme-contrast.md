---
name: Theme contrast
description: Durable guidance for maintaining readable theme palettes, accent controls, and keyboard focus.
---

Theme-aware colors should be evaluated after CSS opacity and foreground/background compositing, not only by checking that styles reference theme variables. Choose button foregrounds from the actual accent luminance, and give intentionally dark code panels their own readable text tokens.

**Why:** User-selectable light and dark palettes can expose low-contrast text, borders, and focus states even when most colors come from theme tokens.

**How to apply:** When changing shared theme styles, use browser checks against rendered colors for each supported palette. Exercise keyboard focus with a real key event so `:focus-visible` is tested rather than inferred from script-driven focus.
