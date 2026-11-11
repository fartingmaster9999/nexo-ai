---
name: Browser code execution boundary
description: Security, language scope, and on-demand dependency rules for the Nexo code workspace.
---

Run generated Python and JavaScript only in an opaque-origin browser sandbox without application credentials. Nexo Agent may generate, run, inspect, and revise code automatically inside that sandbox. HTML previews must not be granted same-origin access. Their default CSP blocks network requests and external assets; runtime diagnostics are bounded, frame-validated, untrusted text and must never be treated as instructions. Do not add an endpoint that executes generated code in the application server or grant Agent access to the project filesystem or shell.

**Why:** The app server holds provider credentials; allowing arbitrary generated code there would expose them and the project filesystem. The user wants Agent to build and test code autonomously, but within Nexo's browser runner rather than unrestricted host access.

**How to apply:** Preserve cancellation, execution/output limits, isolated workers and explicit errors. Supporting server-dependent or compiled languages requires a separate safely isolated execution service, not a host-process shortcut.

**Why:** A sandboxed page may still attempt to contact external services or send forged messages to its parent. Blocking network access prevents those requests by default, and generated-page diagnostics must not become a prompt-injection path.

**How to apply:** Keep previews in `sandbox="allow-scripts"` iframes without `allow-same-origin`; bind messages to the exact iframe and a per-preview ID, cap diagnostic count and text, and display/forward diagnostics only as plain untrusted text.

Do not enable `allow-forms` to make generated forms work. Support local JavaScript submit handlers while retaining the native submission and network restrictions.

**Why:** The iframe sandbox can block form submission before a valid page's `submit` listener runs. A generated task list consequently showed no runtime errors but its Add button did nothing. Successful rendering and structural metrics are not proof that the controls work.

**How to apply:** Use validated, cancellable local submit events for button activation, Enter, and `requestSubmit`; preserve application cancellation and input validation. Retain the opaque origin and `form-action 'none'`, and verify actual interactions in the real sandbox rather than granting form navigation.

Agent-authored interaction checks are limited evidence of selected local behavior, not independent proof of correctness or persistence. Do not repair a failing app by weakening its assertions.

**Why:** The same code generator supplies both the implementation and its check plan. Passing those checks cannot establish that all requested behavior works, and the opaque origin intentionally cannot verify durable browser storage or a real backend.

**How to apply:** Preserve meaningful assertions during focused repairs, distinguish absent checks from passing checks, and report unverified behavior honestly. Never relax sandbox permissions to expand check coverage.

New Agent-authored files should be available for subsequent Agent edits by default, but explicit context deselections and manual-project privacy must survive revisions and reopening.

**Why:** Follow-up requests lacked the source of the app Agent had just built, so the model guessed a replacement instead of editing the real project. Agent-authored source is already provider-visible; arbitrary manual files are not.

**How to apply:** Default newly generated files into context, preserve existing opt-outs, and do not silently share older unselected or manual files. If an existing project has no files shared, ask for file selection before editing instead of inventing its implementation.

Agent project updates are file upserts, not implicit deletion requests. Validate the combined project before replacing saved files or the working preview.

**Why:** A real revision returned only updated HTML; treating it as a complete replacement dropped its stylesheet and broke the app. Missing assets must not turn an attempted improvement into data loss.

**How to apply:** Retain unmentioned files, keep the entrypoint in update payloads, enforce total limits after merging, and reject missing local assets before committing. Feed validation errors back to Agent for correction while preserving the previous project. File deletion remains an explicit user action.

Valid tool JSON does not prove generated HTML is complete.

**Why:** A real Agent revision wrapped a file ending halfway through an open style block in valid JSON. The browser accepted it without a syntax exception but rendered a blank page, replacing a working counter.

**How to apply:** Reject unfinished HTML raw-text blocks and comments before dispatching a save/run. Keep the prior rendered preview available during follow-up planning; do not hide it behind a first-build placeholder.

Load only the editor language in use and Python packages needed by the executed code, rather than preloading all language modes or scientific packages.

**Why:** The user explicitly requested not to load every language or every Python library. Earlier requests to make scientific libraries available do not mean they should all be downloaded and imported on each run.

**How to apply:** Keep supported packages available on demand, require accurate imports in generated examples, and avoid claiming scientific aliases are preloaded.

Inline quizzes and charts must remain bounded declarative data, not model-authored JavaScript, HTML, or chart option functions executed in the trusted chat page.

**Why:** The user wants interactive answers without opening the IDE. That does not relax the isolation boundary for arbitrary generated code; safe built-in widget renderers can meet this requirement without granting execution privileges.

**How to apply:** Extend validated schemas and built-in renderers for new widget types. Compute supported mathematical formulas through fixed application logic; never evaluate model expressions. Keep quiz state attached to its owning conversation/message, and require retrieved source provenance for charts claiming verified web data.

Math preprocessing must leave inline and fenced code source untouched. If a renderer normalizes Markdown delimiters before parsing, code copy and widget positions must use the same normalized source.

**Why:** Markdown node offsets describe the exact input text. Changing delimiters before code blocks can shift those offsets and silently select different copied code or widget data.

**How to apply:** Limit math normalization to prose, keep parser/copy/widget source aligned, and test dollar and backslash delimiters inside both inline and fenced code.
