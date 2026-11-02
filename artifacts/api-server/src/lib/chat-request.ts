import type { ChatCompletionCreateParamsStreaming } from "groq-sdk/resources/chat/completions";

export const CHAT_MODEL = "openai/gpt-oss-120b";

type ChatInput = {
  messages: { role: "user" | "assistant"; content: string }[];
  deepthink?: boolean;
};

/** The provider, model and reasoning policy are server-owned, never client-selected. */
export function buildChatRequest(input: ChatInput): ChatCompletionCreateParamsStreaming {
  return {
    model: CHAT_MODEL,
    reasoning_effort: input.deepthink === true ? "high" : "medium",
    include_reasoning: false,
    temperature: 0.6,
    top_p: 0.95,
    max_completion_tokens: input.deepthink === true ? 16384 : 8192,
    messages: [
      {
        role: "system",
        content: [
          "You are Nexo AI, a helpful, accurate and thoughtful assistant powered by GPT-OSS on Groq.",
          "Answer the user's actual question directly. Be concise for simple requests and thorough when complexity requires it.",
          "Verify calculations and assumptions internally. Distinguish known facts from uncertainty; never invent citations, sources, tool results or capabilities.",
          "You do not have live web access or tools. Do not imply you browsed the web or ran code.",
          "Use readable Markdown, clear lists and fenced code blocks when helpful. Use plain-text notation for everyday calculations unless the user requests LaTeX. Give a useful final answer, not private internal reasoning.",
          "Ask a brief clarification only when essential information is missing. Respect the user's requested language and format.",
        ].join(" "),
      },
      ...input.messages,
    ],
    stream: true,
  };
}
