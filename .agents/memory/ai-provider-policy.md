---
name: Nexo AI provider policy
description: User-required provider restrictions and interpretation of GPT-OSS's publisher namespace.
---

Nexo AI must use Groq with the user's own API key. Do not add an OpenAI API connection, Replit AI Integrations billing, or a fallback to either.

**Why:** The user explicitly required Groq-hosted GPT-OSS instead of OpenAI billed through Replit and said to never use OpenAI. They requested GPT-OSS specifically; its `openai/` model namespace identifies its publisher, not the inference provider.

**How to apply:** Keep normal text-chat inference on Groq; do not fall back to Gemini for ordinary chat. Use Gemini only for the user-selected image and Agent routes. Normal Groq reasoning should be medium and Deepthink should raise it to high unless the user changes that requirement.

The user chose their own Gemini API key for image understanding and Nexo Agent. Keep Gemini credentials server-side and configure them separately in Replit and any external host such as Vercel.

**Why:** Gemini is an opt-in route for multimodal/Agent features, not a replacement for Groq's normal chat path. Hosting environments do not share secret stores.

**How to apply:** Read `GEMINI_API_KEY` from the server environment only. Never pass it to the browser, write it into tracked configuration, or reuse it as a Groq credential.

The user permits fallback between models within Groq: use GPT-OSS 120B normally, GPT-OSS 20B after ordinary-chat quota exhaustion, and Qwen3.8 27B after coding quota exhaustion. Prefer a dedicated coder model only if Groq actually makes one available.

**Why:** The user requested these model-specific fallbacks to keep chatting after per-model limits are reached. This changes the model policy, not the prohibition on OpenAI-hosted inference or Replit AI billing.

**How to apply:** Make downgrades visible, do not invent unavailable model IDs, and do not imply model switching can bypass an account-wide quota.

Validate Groq model capabilities with a live request instead of trusting the SDK's general option types.

**Why:** The SDK accepts citation settings that GPT-OSS rejects at runtime, even though this model does support native browser search. Tool support and individual output options have separate compatibility constraints.

**How to apply:** Check the selected model's documentation and make one targeted live call when enabling new provider features. Keep web retrieval external as required by the search policy, regardless of native browser capabilities.

Do not interpret every Groq 429 as exhausted daily requests. Token and request limits are independent and organization-wide; reasoning and repeated conversation history consume tokens.

**Why:** A reported quota issue was reproducible as Nexo downgrading while direct 120B calls still succeeded with daily request allowance remaining. Later diagnostics confirmed a daily token (TPD) rejection despite remaining daily requests. Artificial minimum cooldowns can also outlast short provider rejection windows.

**How to apply:** Honor provider retry windows, avoid long invented cooldowns, and retain only allowlisted quota diagnostics (metric, counters, reset/retry headers), never raw upstream bodies or prompts. Distinguish observed limits from an unproven historical cause.

A successful fallback should be described as a model switch that allows continued chatting, not as overall usage exhaustion.

**Why:** The user reported a contradictory usage-limit warning while answers were still arriving from the fallback model.

**How to apply:** Announce the fallback only after the provider accepts its stream, use a neutral informational notice, and reserve the blocking usage-limit error for failure of every eligible model. Normalize older saved fallback notices when displaying them.

For Nexo Agent, transient non-rate-limit Gemini 3.8 failures may fall back to Gemini 3.6 before tools run. When Gemini is rate-limited, switch to Groq Qwen3.8 27B, announce the fallback, and keep the run on Groq through later tool continuations.

**Why:** The user explicitly wants Agent runs to continue on Qwen3.8 27B after Gemini rate limits. Groq's tool-call format differs from Gemini's, so continuation history must be converted and kept with the selected provider.

**How to apply:** Preserve same-provider continuation histories; convert prior Agent tool exchanges when switching once, then do not switch back. Qwen fallback cannot inspect attached images; tell the user rather than pretending it can. Agent-built code may run autonomously only in the existing isolated browser sandbox, never on the API server or project filesystem.
