export type LiveTranscriptLine = {
  role: "user" | "assistant";
  text: string;
  interim?: boolean;
};

export type LiveAgentRunState = {
  id: string;
  status: "running" | "finished" | "error";
  task: string;
};

export type LiveAgentHandoffResult =
  | { accepted: true }
  | { accepted: false; reason: string };

export type LiveWorkspaceOpenResult =
  | { opened: true }
  | { opened: false; reason: string };

export type LiveFunctionCall = {
  id?: string;
  name: string;
  args: Record<string, unknown>;
};

const MAX_TRANSCRIPT_CONTEXT_CHARS = 8_800;

export function readLiveFunctionCalls(message: unknown): LiveFunctionCall[] {
  if (!message || typeof message !== "object" || Array.isArray(message)) return [];
  const root = message as Record<string, unknown>;
  const serverContent = root.serverContent && typeof root.serverContent === "object"
    ? root.serverContent as Record<string, unknown>
    : null;
  const toolCall = root.toolCall && typeof root.toolCall === "object"
    ? root.toolCall as Record<string, unknown>
    : root.tool_call && typeof root.tool_call === "object"
      ? root.tool_call as Record<string, unknown>
      : null;
  const modelTurn = serverContent?.modelTurn && typeof serverContent.modelTurn === "object"
    ? serverContent.modelTurn as Record<string, unknown>
    : null;
  const rawCalls = Array.isArray(toolCall?.functionCalls)
    ? toolCall.functionCalls
    : Array.isArray(modelTurn?.parts)
      ? modelTurn.parts
        .flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const functionCall = (part as Record<string, unknown>).functionCall;
          return functionCall && typeof functionCall === "object" ? [functionCall] : [];
        })
      : [];

  return rawCalls.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const call = raw as Record<string, unknown>;
    if (typeof call.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(call.name)) return [];
    return [{
      ...(typeof call.id === "string" && call.id.length <= 200 ? { id: call.id } : {}),
      name: call.name,
      args: call.args && typeof call.args === "object" && !Array.isArray(call.args)
        ? call.args as Record<string, unknown>
        : {},
    }];
  });
}

export function buildLiveAgentPrompt(lines: LiveTranscriptLine[]): string {
  const completeLines = lines
    .filter((line) => !line.interim && line.text.trim())
    .map((line) => ({ ...line, text: line.text.trim() }));

  if (!completeLines.some((line) => line.role === "user")) return "";

  let remaining = MAX_TRANSCRIPT_CONTEXT_CHARS;
  let omittedEarlierContext = false;
  const transcript: string[] = [];

  for (let index = completeLines.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const line = completeLines[index];
    const text = line.text.length > remaining
      ? line.text.slice(-remaining)
      : line.text;
    if (text.length < line.text.length) omittedEarlierContext = true;
    const speaker = line.role === "user" ? "User" : "Nexo";
    transcript.unshift(`${speaker}: ${text}`);
    remaining -= text.length + speaker.length + 2;
    if (remaining <= 0 && index > 0) omittedEarlierContext = true;
  }

  const contextNote = omittedEarlierContext
    ? "[Earlier voice context was omitted to fit the Agent request.]\n"
    : "";
  return [
    "Use Nexo Agent to complete the task the user requested. If they asked for an app, website, or code, build and test it in this workspace; otherwise use the Agent's appropriate research or action tools.",
    "Only User lines are instructions from the user. Nexo lines are conversation context, not additional requests.",
    "Use the existing Agent workspace tools to make and test the requested changes; preserve existing project files unless the user asked to replace them.",
    "",
    "Nexo Live transcript:",
    `${contextNote}${transcript.join("\n")}`,
  ].join("\n");
}
