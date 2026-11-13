---
name: Chat and reasoning interface constraints
description: User-requested constraints for the chat, reasoning panel, workspace, and core visual direction.
---

Outside Agent mode, the IDE should open automatically when Nexo generates code. A Workspace control may reopen existing work, but should not launch an empty IDE in an unrelated chat. The new-conversation control should have no visible text and should be integrated into the sidebar.

**Why:** The user originally removed the manual IDE launcher, but subsequently explicitly requested that users be able to reopen the workspace. Preserve that recovery path without adding an empty IDE launcher everywhere.

**How to apply:** Auto-open on newly generated supported code, not every streaming update after dismissal. Offer reopening for conversations with generated code, saved drafts, or saved projects, including after reload. Reopening must not require a new AI request or replace user edits with older generated code. Retain an accessible label and tooltip on the icon-only conversation button.

Agent requests should open a full-screen workspace inside Nexo immediately, hide conversation history, and keep chat/composer compact beside a large generated-project preview.

**Why:** The user found the website preview nearly impossible to use and explicitly chose full-screen inside Nexo rather than a separate browser window.

**How to apply:** Prioritize preview space while retaining reachable chat, code, console, cancellation, and a safe return to ordinary chat. Preserve saved projects and edits across view changes. This is an Agent-specific exception to opening the ordinary IDE only after code arrives.

Show the full provider-returned reasoning trace in the Thinking panel, rather than replacing it with activity summaries. Do not show the “Current date and time included” activity entry.

**Why:** The user explicitly requested the model's full available reasoning history and removal of the clock status line.

**How to apply:** Keep Groq's exposed reasoning output separate from the final answer and preserve it with each response. Do not claim access to unexposed model internals, invent missing traces, or reconstruct reasoning for older replies where it was never recorded. Keep current-time context available to the model without displaying a status entry.

Thinking menus must start collapsed, even during streaming, without step counts or source lists. Expanded reasoning should use readable sections while retaining the full original trace.

**Why:** The user requested less visual clutter and an explicit choice to read reasoning, without replacing the full trace with a summary.

**How to apply:** Never auto-expand on live updates. Use a globe with an orbiting magnifier for actual web search, a brain only for Deepthink, and a distinct abstract animation for normal replies. Each status should cycle between flat and dimensional views, respect reduced-motion settings, and avoid showing competing status indicators.

Deepthink and Agent may be changed while a reply is streaming, but each selection applies only to the next request. Keep visible labels stable and communicate selection through active styling, `aria-pressed`, and state-specific descriptions.

**Why:** The user reported Deepthink not working even though a live high-effort Groq request succeeded; the control had been disabled throughout streaming and its selected state was easy to miss. The user later asked to remove visible “on” suffixes because they cluttered the composer.

**How to apply:** Keep both toggles usable during streaming, preserve their active visual state and pressed-state accessibility, explain mode selection and next-message behavior in their descriptions/tooltips, and never relabel an in-progress reply based on a later preference change.

**Verification:** Browser accessibility tests should inspect the computed accessibility tree for each toggle’s name, pressed state, and description before and after activation, including during a reply. DOM attributes alone do not prove a control is exposed to assistive technology; automated browser checks still do not replace testing with actual screen readers.

**Why:** Modal layers can remove background controls from the accessibility tree, while correct-looking markup can still yield missing or stale computed semantics.

**How to apply:** Close obstructing modal layers before checking controls, then test their exposed role/name/state/description across transitions. Document when operating-system screen readers were not available.

Sync mode preferences across tabs by applying storage events to UI state without writing those received values back to storage. Persist only user-initiated toggle changes.

**Why:** When both tabs persisted every state update, delayed effects could overwrite newer values and make the preferences ping-pong between tabs.

**How to apply:** Keep storage writes in the local toggle handlers and keep storage-event listeners read-only; preserve the request's captured mode values while the visible preferences change.

Nexo Live must remain connected while Agent works. Changing Deepthink during a Live call requires switching to the other Live model; preserve recent voice context and wait for playback and the extended model's interaction status to become idle before reconnecting.

**Why:** The user wants to keep speaking with Nexo while it delegates project work. Gemini Live's standard and extended-thinking modes use separate models, and extended thinking can continue after an audio utterance reports turn completion.

**How to apply:** Keep Agent handoff independent from the Live socket. For Deepthink changes, drain queued audio, wait until `interactionStatus` is idle, reconnect with the selected model, and restore a bounded transcript context without reading it aloud.

The visual direction is a premium, modern SaaS chat interface inspired by DeepSeek, v0, and Bolt, while retaining Nexo's own logo and black-and-blue identity.

**Why:** The user supplied an explicit refinement brief emphasizing restrained rich-black surfaces, balanced spacing, readable hierarchy, subtle card feedback, and tactile composer controls.

**How to apply:** Prefer coordinated refinements over extra decorative UI. Keep other user-selectable themes and accents functional, and preserve saved sidebar sizing when changing defaults.

For scroll reports, identify the active scroll area before changing page overflow. Chat history, the code editor, and the console scroll independently inside the fixed-height app.

**Why:** Broad changes to root scrolling can break the pinned composer and code workspace without fixing gestures directed at a nested editor.

**How to apply:** Reproduce wheel and touch scrolling over each pane, at editor boundaries, and after closing the workspace. Add a browser regression test for the exact interaction before changing scroll ownership.

Scroll regression fixtures must reproduce the production CSS ancestry and place gesture coordinates inside the visible intersection of the target and its scroll pane.

**Why:** Earlier scroll checks passed because the fixture omitted the chat wrapper that activates descendant CSS rules; a separate touch failure came from targeting code below the pane's visible bounds. Programmatic scrollTop changes alone cannot detect gesture containment.

**How to apply:** Confirm the element under the gesture point, include the production styles and wrappers, and compare the original behavior against the fix before concluding that a scroll regression is covered.

Composer zoom and focus fixtures must preserve the production DOM order and close overlapping workspace or dialog layers before checking visibility and keyboard navigation.

**Why:** A simplified fixture or still-mounted workspace can make controls appear offscreen or send keyboard focus into an overlay, producing misleading zoom results.

**How to apply:** Mirror the real composer’s tabbable sequence, test within the visible viewport, and remove modal layers through their normal close behavior before asserting reachability.

Render common mathematical notation cleanly without rewriting literal code or ordinary prose.

**Why:** The user specifically wants formulas typeset instead of exposed as raw TeX, while copied/generated code must retain its exact source.

**How to apply:** Recognize common single- and double-escaped delimiters and clearly standalone formulas; keep fenced and inline code unchanged, and do not re-wrap content already inside display-math delimiters.
