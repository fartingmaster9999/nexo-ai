---
name: Code-triggered workspace and sidebar controls
description: User-requested automatic IDE opening for generated code and conversation-button presentation.
---

The IDE should open automatically when Nexo generates code, with no physical button to open it manually. The new-conversation control should have no visible text and should be integrated into the sidebar.

**Why:** The user explicitly reversed the opt-in IDE request: it should open only when code is generated, and the manual Workspace button should be removed. The smaller embedded conversation control remains requested.

**How to apply:** Open the IDE when a newly generated supported code block arrives, without reopening it on every streaming update after dismissal. Do not show a manual open button. Retain an accessible label and tooltip on the icon-only conversation button.

Show the full provider-returned reasoning trace in the Thinking panel, rather than replacing it with activity summaries. Do not show the “Current date and time included” activity entry.

**Why:** The user explicitly requested the model's full available reasoning history and removal of the clock status line.

**How to apply:** Keep Groq's exposed reasoning output separate from the final answer and preserve it with each response. Do not claim access to unexposed model internals, invent missing traces, or reconstruct reasoning for older replies where it was never recorded. Keep current-time context available to the model without displaying a status entry.

Thinking menus must start collapsed, even during streaming, without step counts or source lists. Expanded reasoning should use readable sections while retaining the full original trace.

**Why:** The user requested less visual clutter and an explicit choice to read reasoning, without replacing the full trace with a summary.

**How to apply:** Never auto-expand on live updates. Use a globe with an orbiting magnifier for actual web search, a brain only for Deepthink, and a distinct abstract animation for normal replies. Each status should cycle between flat and dimensional views, respect reduced-motion settings, and avoid showing competing status indicators.

Deepthink may be changed while a reply is streaming, but the selection applies only to the next request. Each reply retains the mode captured when it was sent.

**Why:** The user reported Deepthink not working even though a live high-effort Groq request succeeded; the control had been disabled throughout streaming and its selected state was easy to miss.

**How to apply:** Keep the toggle usable, make its on state visibly blue and clearly labeled, explain next-message behavior in its tooltip, and never relabel an in-progress reply based on a later preference change.

The visual direction is a premium, modern SaaS chat interface inspired by DeepSeek, v0, and Bolt, while retaining Nexo's own logo and black-and-blue identity.

**Why:** The user supplied an explicit refinement brief emphasizing restrained rich-black surfaces, balanced spacing, readable hierarchy, subtle card feedback, and tactile composer controls.

**How to apply:** Prefer coordinated refinements over extra decorative UI. Keep other user-selectable themes and accents functional, and preserve saved sidebar sizing when changing defaults.
