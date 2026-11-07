import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import type { AgentChatInput, AgentToolExchange } from "@workspace/api-zod";
import { boundedHistory } from "./chat-request";
import { agentSystemPrompt, type AgentModelResponse, MAX_AGENT_RESPONSE_CHARS } from "./gemini-agent";
import { CODING_FALLBACK } from "./model-routing";

export const GROQ_AGENT_MODEL = CODING_FALLBACK;
const MAX_TOOL_ARGUMENT_CHARS = 24_000;

const agentTools: ChatCompletionTool[] = [{
  type: "function",
  function: {
    name: "web_search",
    description: "Search public websites only for current, changing, or 2024-and-later facts, or when the user explicitly asks. Do not search for stable facts or routine coding.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "A focused public web search query, 2 to 300 characters." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
}, {
  type: "function",
  function: {
    name: "run_code",
    description: "Build and run code in Nexo's isolated browser workspace. Supported languages: Python, JavaScript, sandboxed HTML. Use one call at a time; inspect errors and revise when needed. No shell, server filesystem, or arbitrary packages.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript", "html"] },
        code: { type: "string", description: "Complete runnable source code, at most 20000 characters." },
      },
      required: ["language", "code"],
      additionalProperties: false,
    },
  },
}];

function groqHistory(history: AgentToolExchange[]): ChatCompletionMessageParam[] {
  return history.flatMap((exchange) => [
    {
      role: "assistant" as const,
      tool_calls: [{
        id: exchange.callId,
        type: "function" as const,
        function: { name: exchange.tool, arguments: JSON.stringify(exchange.arguments) },
      }],
    },
    {
      role: "tool" as const,
      tool_call_id: exchange.callId,
      content: JSON.stringify({
        result: exchange.result,
        ...(exchange.sources?.length ? { sources: exchange.sources } : {}),
      }),
    },
  ]);
}

export function buildGroqAgentRequest(
  input: AgentChatInput,
  now = new Date(),
  allowTools = true,
): ChatCompletionCreateParamsStreaming {
  const timeZone = input.timeZone ?? "UTC";
  const history = boundedHistory(input.messages, 16_000);
  if (history.at(-1)?.role !== "user") throw new Error("The conversation must end with the user's message");
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: agentSystemPrompt(now, timeZone, false, Boolean(input.image)),
    },
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    } as ChatCompletionMessageParam)),
    ...groqHistory(input.agentHistory ?? []),
  ];
  return {
    model: GROQ_AGENT_MODEL,
    messages,
    stream: true,
    temperature: 0.6,
    max_completion_tokens: input.deepthink === true ? 8192 : 4096,
    reasoning_effort: input.deepthink === true ? "high" : "medium",
    reasoning_format: "parsed",
    tool_choice: allowTools ? "auto" : "none",
    parallel_tool_calls: false,
    ...(allowTools ? { tools: agentTools } : {}),
  };
}

export type GroqAgentChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
};

export async function collectGroqAgentResponse(
  stream: AsyncIterable<GroqAgentChunk>,
  signal: AbortSignal,
  onChunk: () => void = () => {},
): Promise<AgentModelResponse> {
  let text = "";
  const pending = new Map<number, { callId: string; name: string; arguments: string }>();
  for await (const chunk of stream) {
    signal.throwIfAborted();
    onChunk();
    const delta = chunk.choices?.[0]?.delta;
    if (typeof delta?.content === "string") {
      text += delta.content;
      if (text.length > MAX_AGENT_RESPONSE_CHARS) throw new Error("Qwen's response exceeded the Agent output limit.");
    }
    for (const item of delta?.tool_calls ?? []) {
      const call = pending.get(item.index) ?? { callId: "", name: "", arguments: "" };
      if (typeof item.id === "string") call.callId += item.id;
      if (typeof item.function?.name === "string") call.name += item.function.name;
      if (typeof item.function?.arguments === "string") call.arguments += item.function.arguments;
      if (call.arguments.length > MAX_TOOL_ARGUMENT_CHARS) throw new Error("Qwen returned an oversized Agent tool request.");
      pending.set(item.index, call);
    }
  }

  const calls = [...pending.values()].map((call) => {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      throw new Error("Qwen returned invalid Agent tool arguments.");
    }
    if (!call.callId || call.callId.length > 128 ||
        (call.name !== "web_search" && call.name !== "run_code") ||
        !args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("Qwen returned an incomplete Agent tool request.");
    }
    return {
      tool: call.name as "web_search" | "run_code",
      callId: call.callId,
      thoughtSignature: "groq-agent-v1",
      arguments: args as Record<string, unknown>,
    };
  });
  return { text, calls };
}
