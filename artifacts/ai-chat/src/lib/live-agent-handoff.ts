export type LiveTranscriptLine = {
  role: "user" | "assistant";
  text: string;
  interim?: boolean;
};

const MAX_TRANSCRIPT_CONTEXT_CHARS = 8_800;

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
    "Build the app or code the user requested in this Nexo Agent workspace.",
    "Only User lines are instructions from the user. Nexo lines are conversation context, not additional requests.",
    "Use the existing Agent workspace tools to make and test the requested changes; preserve existing project files unless the user asked to replace them.",
    "",
    "Nexo Live transcript:",
    `${contextNote}${transcript.join("\n")}`,
  ].join("\n");
}
