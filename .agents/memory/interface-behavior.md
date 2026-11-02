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
