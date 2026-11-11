---
name: Nexo AI provider policy
description: User-required provider restrictions and interpretation of GPT-OSS's publisher namespace.
---

Nexo AI must use Groq with the user's own API key. Do not add an OpenAI API connection, Replit AI Integrations billing, or a fallback to either.

**Why:** The user explicitly required Groq-hosted GPT-OSS instead of OpenAI billed through Replit and said to never use OpenAI. They requested GPT-OSS specifically; its `openai/` model namespace identifies its publisher, not the inference provider.

**How to apply:** Keep normal text-chat inference on Groq; do not fall back to Gemini for ordinary chat. Use Gemini only for the user-selected image, Agent, and Live voice routes. Normal Groq reasoning should be medium and Deepthink should raise it to high unless the user changes that requirement.

The user chose their own Gemini API key for image understanding and Nexo Agent. Keep Gemini credentials server-side and configure them separately in Replit and any external host such as Vercel.

**Why:** Gemini is an opt-in route for multimodal/Agent features, not a replacement for Groq's normal chat path. Hosting environments do not share secret stores.

**How to apply:** Read `GEMINI_API_KEY` from the server environment only. Never pass it to the browser, write it into tracked configuration, or reuse it as a Groq credential.

Gemini Live browser sessions must use a short-lived, one-use token created by the server and constrained to Nexo's supported Live model and audio configuration. In the public-key app, forward the visitor's Gemini key only to create that token; never send the long-lived key to the browser's WebSocket.

**Why:** Live voice uses a browser-to-Google WebSocket, so sending the normal Gemini API key to the browser would expose a reusable credential.

**How to apply:** Keep token issuance server-side, lock the supported model and session configuration, and never cache or log the returned ephemeral token. Treat Live audio as a separate Gemini route; normal chat stays on Groq.

Fail a Live call explicitly when the connection cannot keep up, rather than silently dropping speech or retaining an unbounded audio backlog.

**Why:** Replaying delayed microphone input into a later turn changes what the user meant, and unbounded playback can leave the interface apparently active but far behind the conversation.

**How to apply:** Bound incoming messages, outgoing microphone data, and scheduled playback independently. On overflow, release the microphone and audio resources and offer a new call; do not reuse buffered audio in another session.

Prefer Gemini for non-coding Agent work when configured, and for image understanding, review, and Live. For new coding requests, use a brief Groq GPT-OSS planning pass followed by Qwen for code generation and repair; coding must not depend on Gemini credentials or model discovery.

**Why:** The user reports that Qwen is the only model visibly called for coding, GPT-OSS is rarely called, and Gemini planning is slow or absent. They asked to use Groq GPT-OSS for planning because Groq calls are fast.

**How to apply:** Keep the GPT-OSS planning pass tool-free, concise, and separately time-bounded; fall back from 120B to 20B, then let Qwen proceed directly if planning fails. Do not call Gemini for coding-plan discovery. Keep Gemini for configured non-coding Agent work, image routes, code review, and Live. Ordinary non-Agent chat remains on Groq.

Optional feedback needs a fixed elapsed-time budget, not just an idle timeout that resets on every streamed chunk. A short advisory deadline expiring is not proof that a model is unhealthy.

**Why:** Planning could consume most of the build deadline while still receiving chunks, and review could enter the main Agent's retry/fallback chain. The user wants less waiting without losing the working project.

**How to apply:** Keep feedback deadlines independent of main generation, discard incomplete findings, preserve completed tools, and let Qwen continue with actual run evidence when review is skipped. Reuse successful feedback only for identical source, prompt, images, and run evidence within the same run; never reuse failures as findings.

Model availability caches must be isolated by credential identity, including in-flight lookups and negative results.

**Why:** A process-wide catalog could give a public-key visitor another account's model access, including after their own authorization failed.

**How to apply:** Use a non-reversible credential digest for bounded cache keys, do not retain or log the key itself, and do not substitute a different account's cached models on failure.

Use only live-catalog Gemma 4 models for the Agent's independent post-run code review. Feed its bounded findings and the isolated runner's outputs/checks to Qwen as untrusted tool results; Gemma must not modify code or execute tools.

**Why:** The user wants a second model to spot defects in the generated program for Qwen to fix. The browser preview deliberately uses an opaque-origin sandbox and does not expose page pixels or DOM text to the parent.

**How to apply:** Review generated source, runtime output, and sanitized structural preview checks. A generated plot image may be reviewed when supplied; do not claim visual screenshot inspection for HTML websites. If Gemma 4 is unavailable, let Qwen continue without the review and state that it was skipped. Never weaken preview isolation to capture content.

Use GPT-OSS 120B for ordinary text chat, with GPT-OSS 20B as its quota fallback. Ordinary chat coding stays on Qwen. Agent coding may fall back from Qwen to Groq-hosted GPT-OSS 120B, then GPT-OSS 20B.

**Why:** The user previously required Qwen-only coding, but explicitly superseded that restriction for Agent: “Make agent also call gpt-oss 120b and 20b for coding, not just qwen. Rate limits affect it and then you have a delay.” The no-OpenAI-API restriction still applies; all three models run through Groq.

**How to apply:** Agent starts coding on an available catalog-verified Qwen model, then tries ready GPT-OSS 120B and 20B before waiting on a 429. Keep a successful Groq fallback through tool continuations and retain completed tool results without rerunning actions. Use model-family-specific request options, and announce a switch only after it succeeds. Retain coding intent across follow-ups such as “add a filter.” Do not broaden ordinary chat coding or Gemini image routes. Never invent unavailable models or imply that switching bypasses shared provider quotas.

Validate Groq model capabilities with a live request instead of trusting the SDK's general option types.

**Why:** The SDK accepts a union of request options across models, not a per-model guarantee. GPT-OSS rejects citation settings and `reasoning_format`; non-reasoning Llama models reject reasoning controls. Tool support and individual output options have separate compatibility constraints.

**How to apply:** Build options per model family, check the selected model's documentation and make one targeted live call when enabling new provider features. Keep web retrieval external as required by the search policy, regardless of native browser capabilities. Gemini catalogs advertise `generateContent` for generation-capable models, including streaming; requiring a separate `streamGenerateContent` entry can incorrectly exclude the whole provider.

Do not interpret every Groq 429 as exhausted daily requests. Token and request limits are independent and organization-wide; reasoning and repeated conversation history consume tokens.

**Why:** A reported quota issue was reproducible as Nexo downgrading while direct 120B calls still succeeded with daily request allowance remaining. Diagnostics subsequently identified both daily token (TPD) and output-token-per-minute (OTPM) rejections despite remaining daily requests. A single build can exceed an output allowance even when the request counter is almost unused. Cached cooldowns and oversized requests are not proof of model-wide exhaustion.

**How to apply:** Prefer models outside provider retry windows, but treat cooldowns as routing hints rather than proof of current exhaustion. When every compatible candidate is cached, permit one bounded live check of the earliest-expiring candidate and clear its cooldown on success. Do not cache request-size rejections as model-wide outages. Retain only allowlisted quota diagnostics (metric, numeric counters, reset/retry headers), never raw upstream bodies or prompts. Distinguish observed limits from an unproven historical cause, especially across Replit and Vercel accounts.

Catalog visibility is not proof of permission to generate with a model. Agent coding fallback must cover model access denial and unavailability, not only rate limits.

**Why:** Coding had a separate exclusion from compatible-model recovery, so a listed model's access denial stopped builds despite other approved models being available.

**How to apply:** Try remaining catalog-verified coding models on 403/404 and recoverable service failures, with bounded attempts and preserved tool history. Do not fan out on 401: that is a credential failure. Report authorization failures separately from quota exhaustion.

Treat Groq HTTP 413 as request-size rejection, separately from HTTP 429 and timeouts.

**Why:** A live Agent build saved a partial website but its continuation failed with HTTP 413. Increasing retry waits could not resolve an oversized continuation; the generic error hid the distinction.

**How to apply:** Permit only a bounded recovery that actually reduces the outgoing request. Preserve the newest prompt and complete current source, mark omitted context, and never alter saved history or rerun completed tools. Do not classify 413 as exhausted quota or switch coding to GPT-OSS. If safe compaction cannot fit, report the size limitation rather than silently cutting code.

Explicit output allowances may justify one smaller-budget retry on the same model, but never an incomplete project. Agent may first use another approved Groq coding model.

**Why:** Large code generations were being misdescribed as exhausted daily model quotas. The user now permits Agent model fallback, but truncating tool JSON or replacing an existing project with a stub would still lose correctness.

**How to apply:** Learn caps only from verified provider quota metadata, bound recovery attempts, keep existing features, and reject truncated tool output before execution. Agent may first try another ready coding model under the newer routing policy. Explain when a complete change cannot fit; do not claim the provider's limits have been bypassed.

Under a learned small Qwen output allowance, reserve the budget for complete code rather than optional reasoning.

**Why:** A real browser build/edit test exhausted the constrained response budget and generated incomplete source. A targeted live request confirmed that the configured Qwen model accepts `reasoning_effort: "none"`.

**How to apply:** Honor the observed output cap, disable optional reasoning only on constrained output or bounded truncation recovery, and retry before dispatching any partial tool calls. Re-verify this capability when changing Qwen models; do not raise the budget past the provider's observed allowance.

An Agent continuation can hit the output window after its project already ran successfully. Honor a bounded series of explicit short provider retry windows without rerunning saved tools or discarding the project.

**Why:** The code-generation response used most of the available output allowance, and the immediate final-response call failed despite a working preview. Showing that as a failed build concealed the actual cause. The user explicitly chose longer automatic waiting over having to resend a request after another short-window rejection.

**How to apply:** Distinguish short-window exhaustion from an oversized response or daily quota; use the provider's stated delay rather than guessing, preserve tool results, and keep all waits bounded and cancellable. In Agent, first use another ready coding model when available. Reserve hosting-deadline headroom for the resumed response rather than spending the entire request lifetime waiting.

A successful fallback should be described as a model switch that allows continued chatting, not as overall usage exhaustion.

**Why:** The user reported a contradictory usage-limit warning while answers were still arriving from the fallback model.

**How to apply:** Announce the fallback only after the provider accepts its stream, use a neutral informational notice, and reserve the blocking usage-limit error for failure of every eligible model. Normalize older saved fallback notices when displaying them.

For Nexo Agent, transient non-rate-limit Gemini 3.8 failures may fall back to Gemini 3.6 before tools run. When Gemini is rate-limited, switch to Groq Qwen3.8 27B, announce the fallback, and keep the run on Groq through later tool continuations.

**Why:** The user explicitly wants Agent runs to continue on Qwen3.8 27B after Gemini rate limits. Groq's tool-call format differs from Gemini's, so continuation history must be converted and kept with the selected provider.

**How to apply:** Preserve same-provider continuation histories; convert prior Agent tool exchanges when switching once, then do not switch back. Qwen fallback cannot inspect attached images; tell the user rather than pretending it can. Agent-built code may run autonomously only in the existing isolated browser sandbox, never on the API server or project filesystem.

Diagnose blank Gemini replies from model finish/block metadata, not just HTTP success or the presence of an API key.

**Why:** Production Agent requests opened successful SSE connections but ended without any visible answer after model fallback. The original logs hid that outcome. Gemini also counts private thinking and visible answer tokens against the same output allowance, so an apparently generous limit can still leave no answer text; token exhaustion must be confirmed rather than inferred.

**How to apply:** Reserve answer headroom, keep recovery attempts bounded, and retain only safe finish/block codes in diagnostics. Never expose or log private thought text, full provider payloads, prompts, or credentials to investigate empty output.

A Groq SDK error with no HTTP status is not necessarily a connection failure: the SDK also raises statusless API errors for provider error events inside successful SSE responses.

**Why:** Production Agent failures were labeled only as `HTTP unknown`, obscuring the difference between transport problems and rejected streamed tool generation. A past successful request is not proof that later payload variants are supported by the same model.

**How to apply:** Classify SDK connection/timeout subclasses separately from in-stream errors, using only allowlisted provider codes. Never log SDK error messages or failed-generation payloads, which can contain generated code or user content. Retry only bounded recoverable generations before tool dispatch, keeping prior tool results intact.

Gemini's function-call ID is optional; its required thought signature must still be preserved. A missing provider ID is not a malformed tool call.

**Why:** Google's public API discovery schema explicitly marks `FunctionCall.id` optional. Requiring it rejects valid Agent actions, while adding a generated ID to the original signed provider part can change the replayed request.

**How to apply:** Use a unique local execution identifier when Google omits its ID, but omit that local identifier from Gemini function-call/result history. Never synthesize a missing Gemini thought signature. Retry interrupted generations only before dispatching their tools; discard incomplete responses without replaying completed actions.
