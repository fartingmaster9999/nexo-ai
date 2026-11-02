---
name: Code-triggered workspace and sidebar controls
description: User-requested automatic IDE opening for generated code and conversation-button presentation.
---

The IDE should open automatically when Nexo generates code, with no physical button to open it manually. The new-conversation control should have no visible text and should be integrated into the sidebar.

**Why:** The user explicitly reversed the opt-in IDE request: it should open only when code is generated, and the manual Workspace button should be removed. The smaller embedded conversation control remains requested.

**How to apply:** Open the IDE when a newly generated supported code block arrives, without reopening it on every streaming update after dismissal. Do not show a manual open button. Retain an accessible label and tooltip on the icon-only conversation button.
