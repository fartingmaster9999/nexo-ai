export const GEMINI_LIVE_TOOLS = [{
  functionDeclarations: [
    {
      name: "open_workspace",
      description: "Open the current conversation's saved Nexo code workspace. Call only when the user asks to see or open the workspace; do not start a build.",
      behavior: "NON_BLOCKING",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "open_external_link",
      description: "Open a user-requested website, Google Classroom course, or external URL in a new browser tab. Pass only the requested site or class name, URL, or domain. If the app reports a blocked popup, tell the user to tap the open-link button shown in Live.",
      behavior: "NON_BLOCKING",
      parameters: {
        type: "OBJECT",
        properties: {
          target: { type: "STRING", description: "The website or class name, domain, or HTTP(S) URL, such as Literacy classwork, Google Classroom, or chatgpt.com." },
        },
        required: ["target"],
      },
    },
    {
      name: "set_deepthink",
      description: "Turn Deepthink on or off when the user asks to change reasoning depth. Deepthink changes the Live model; the app reconnects and restores the voice conversation context.",
      behavior: "NON_BLOCKING",
      parameters: {
        type: "OBJECT",
        properties: { enabled: { type: "BOOLEAN", description: "Whether Deepthink should be enabled." } },
        required: ["enabled"],
      },
    },
    {
      name: "set_agent_mode",
      description: "Turn the app's Agent mode on or off when the user asks. Explicit requests to build or use Agent can still be delegated while the Live conversation continues.",
      behavior: "NON_BLOCKING",
      parameters: {
        type: "OBJECT",
        properties: { enabled: { type: "BOOLEAN", description: "Whether Agent mode should be enabled for future requests." } },
        required: ["enabled"],
      },
    },
    {
      name: "get_nexo_modes",
      description: "Check the current Deepthink and Agent mode settings when the user asks whether either mode is on.",
      behavior: "NON_BLOCKING",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "start_agent",
      description: "Stage a build request for user confirmation when the user directly asks to create or edit an app, website, or code. This does not start Agent. Never call for casual conversation, hypotheticals, advice, brainstorming, explanations, or when Nexo suggested building but the user did not ask.",
      behavior: "NON_BLOCKING",
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
    "When the user asks to turn Deepthink or Agent mode on or off, call set_deepthink or set_agent_mode with the requested state. Use get_nexo_modes when the user asks which modes are enabled.",
    "When the user asks to open a website, Classroom course, or external link, call open_external_link. Never claim that you cannot open websites; if the browser blocks a new tab, direct the user to the open-link button shown in Live.",
    "Only call start_agent after the user directly asks you to build or edit code, an app, or a website. Do not infer permission from casual conversation, hypothetical ideas, a request for advice, or your own suggestions.",
    "Calling start_agent only stages the request. The app shows the captured task and asks the user to confirm; do not claim Agent has started unless the app later reports that it started. If the user declines, do not try again unless they make a new direct request.",
    "When the user asks to see an existing workspace, call open_workspace.",
    "After the user confirms and the app reports Agent has started, keep this Live session active while Agent works. Do not claim it is finished until the app sends a completion update.",
    "The complete voice transcript is passed to Agent. Do not reveal private reasoning or claim to have performed actions outside this session.",
  ].join(" ");
}
