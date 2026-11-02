---
name: Selective external search
description: Why Nexo searches outside Groq and uses a 2024 relevance threshold.
---

Do not use Groq's built-in browser search. Retrieve public web data externally, only when the question needs recent/current information or facts from 2024 onward. Stable knowledge, ordinary coding, greetings and clock-only questions should not trigger searches.

**Why:** The user reported exhausting Groq limits after two or three searches and explicitly requested external scraping and fewer searches. Their 2024 threshold is an operating preference, not verified evidence of GPT-OSS's training cutoff.

**How to apply:** Preserve short bounded source context and caching, honor site restrictions, and show unavailable verification explicitly. Do not let model-generated claims of searching substitute for actual retrieval.
