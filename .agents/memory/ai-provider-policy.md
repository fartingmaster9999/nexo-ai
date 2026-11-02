---
name: Nexo AI provider policy
description: User-required provider restrictions and interpretation of GPT-OSS's publisher namespace.
---

Nexo AI must use Groq with the user's own API key. Do not add an OpenAI API connection, Replit AI Integrations billing, or a fallback to either.

**Why:** The user explicitly required Groq-hosted GPT-OSS instead of OpenAI billed through Replit and said to never use OpenAI. They requested GPT-OSS specifically; its `openai/` model namespace identifies its publisher, not the inference provider.

**How to apply:** Keep all model inference on Groq. If Groq cannot serve a request, surface the failure rather than switching providers. Normal reasoning should be medium and Deepthink should raise it to high unless the user changes that requirement.
