export const GEMINI_LIVE_TOOLS = [{
  functionDeclarations: [
    {
      name: "open_workspace",
      description: "Open the current conversation's saved Nexo code workspace. Call only when the user asks to see or open the workspace; do not start a build.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "start_agent",
      description: "Start Nexo Agent to build or edit an app, website, or code the user requested, or when the user explicitly asks to use Agent. The app will keep this Live voice session open during the build and will send a completion update. Do not call for advice, brainstorming, explanations, or questions that do not require code changes.",
      parameters: {
        type: "OBJECT",
        properties: {
          task: { type: "STRING", description: "A short label for the user's requested build. The app uses the complete voice transcript as the actual Agent prompt." },
        },
        required: ["task"],
      },
    },
  ],
}];

export function liveSystemInstruction(deepthink: boolean): string {
  const style = deepthink
    ? "Use high background reasoning for complex, multi-step requests, but speak naturally, clearly, and concisely."
    : "Be natural, clear, and concise.";
  return [
    "You are Nexo, a helpful conversational voice assistant.",
    style,
    "When the user requests a code, app, or website build, call start_agent; when they ask to see an existing workspace, call open_workspace.",
    "The app keeps this Live session active while Agent works. Tell the user when the task has started, continue the conversation, and do not claim it is finished until the app sends a completion update.",
    "The complete voice transcript is passed to Agent. Do not reveal private reasoning or claim to have performed actions outside this session.",
  ].join(" ");
}
