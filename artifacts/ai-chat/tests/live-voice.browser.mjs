import assert from "node:assert/strict";
import { withFixture, waitFor } from "./browser-harness.mjs";

await withFixture("tests/live-voice.html", async ({ evaluate }) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('[role="dialog"] .live-start-button'))`), "Live dialog");
  await evaluate(`document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "Live connection setup");
  assert.equal(await evaluate(`window.__liveSocket.binaryType`), "arraybuffer");
  await evaluate(`window.__liveSocket.onmessage({data: new Blob([JSON.stringify({setupComplete:{}})])})`);
  await evaluate(`window.__liveProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4800).fill(.5)}})`);
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.realtimeInput?.audio)`), "microphone PCM upload");
  const input = await evaluate(`window.__liveMessages.find(message=>message.realtimeInput?.audio).realtimeInput.audio`);
  assert.equal(input.mimeType, "audio/pcm;rate=16000");
  assert.equal(Buffer.from(input.data, "base64").length, 3200);

  const protocol = await evaluate(`({
    url: window.__liveUrl,
    setup: window.__liveMessages?.[0],
    hasToken: window.__liveUrl?.includes('access_token=test-ephemeral-token')
  })`);
  assert.match(protocol.url, /BidiGenerateContentConstrained/);
  assert.equal(protocol.hasToken, true);
  assert.equal(protocol.setup.setup.generationConfig.responseModalities[0], "AUDIO");

  await evaluate(`window.__liveSocket.onmessage({data: new Blob([JSON.stringify({serverContent:{
    inputTranscription:{text:"Hello "},
  }})])})`);
  await evaluate(`window.__liveSocket.onmessage({data: new TextEncoder().encode(JSON.stringify({serverContent:{
    inputTranscription:{text:"Nexo"},
    outputTranscription:{text:"Hi there"},
    modelTurn:{parts:[{inlineData:{data:"AAA=",mimeType:"audio/pcm;rate=24000"}}]},
    turnComplete:true
  }})).buffer})`);
  await waitFor(() => evaluate(`document.querySelector('.live-transcript')?.textContent.includes('Hello Nexo') && document.querySelector('.live-transcript')?.textContent.includes('Hi there')`), "Live transcript");
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "audio playback completion");

  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"deepthink-call",name:"set_deepthink",args:{enabled:true}
  }]}})})`);
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.toolResponse?.functionResponses?.[0]?.id === 'deepthink-call')`), "Deepthink tool response");
  await waitFor(() => evaluate(`window.__liveSockets.length === 2 && window.__liveMessages.some(message=>message.setup?.model === 'models/gemini-3.8-live-extended-thinking') && document.querySelector('.live-status')?.textContent === 'Listening'`), "Deepthink Live reconnect");
  const resumedContext = await evaluate(`window.__liveMessages.filter(message=>message.clientContent).map(message=>message.clientContent)`);
  assert.equal(resumedContext[0]?.turns?.[0]?.parts?.[0]?.text?.includes("Hello Nexo"), true);
  assert.equal(await evaluate(`document.querySelector('[data-testid="toggle-live-deepthink"]')?.getAttribute('aria-pressed')`), "true");

  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"agent-mode-call",name:"set_agent_mode",args:{enabled:true}
  }]}})})`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="toggle-live-agent"]')?.getAttribute('aria-pressed') === 'true'`), "Agent mode voice toggle");
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"modes-call",name:"get_nexo_modes",args:{}
  }]}})})`);
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.toolResponse?.functionResponses?.[0]?.id === 'modes-call' && message.toolResponse.functionResponses[0].response.result.deepthink === true && message.toolResponse.functionResponses[0].response.result.agentMode === true)`), "Live mode status");
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"agent-mode-off-call",name:"set_agent_mode",args:{enabled:false}
  }]}})})`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="toggle-live-agent"]')?.getAttribute('aria-pressed') === 'false'`), "Agent mode voice disable");

  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"link-call",name:"open_external_link",args:{target:"chatgpt.com"}
  }]}})})`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="status-live-external-link"] a')?.textContent.includes('chatgpt.com')`), "blocked website link fallback");
  assert.equal(await evaluate(`window.__externalTarget`), "chatgpt.com");

  await evaluate(`document.querySelector('[data-testid="toggle-live-deepthink"]').click()`);
  await waitFor(() => evaluate(`window.__liveSockets.length === 3 && window.__liveMessages.some(message=>message.setup?.model === 'models/gemini-3.8-live') && document.querySelector('.live-status')?.textContent === 'Listening'`), "standard Live reconnect");
  assert.equal(await evaluate(`document.querySelector('[data-testid="toggle-live-deepthink"]')?.getAttribute('aria-pressed')`), "false");

  await evaluate(`(() => {
    for (let index = 0; index < 55; index += 1) {
      window.__liveSocket.onmessage({data: JSON.stringify({serverContent:{inputTranscription:{text:'user '+index}}})});
      window.__liveSocket.onmessage({data: JSON.stringify({serverContent:{outputTranscription:{text:'reply '+index},turnComplete:true}})});
    }
    window.__liveSocket.onmessage({data: JSON.stringify({serverContent:{inputTranscription:{text:'x'.repeat(5000)}}})});
  })()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.live-transcript-line').length === 100`), "bounded transcript history");
  assert.equal(await evaluate(`document.querySelector('.live-transcript-line:last-of-type')?.childNodes[1]?.textContent.length`), 4000);

  await evaluate(`document.querySelector('[aria-label="Mute microphone"]').click()`);
  assert.equal(await evaluate(`window.__liveTrack.enabled`), false);
  assert.equal(await evaluate(`window.__liveMessages.at(-1).realtimeInput.audioStreamEnd`), true);
  const audioBefore = await evaluate(`window.__liveMessages.filter(message=>message.realtimeInput?.audio).length`);
  await evaluate(`window.__liveProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4800)}})`);
  assert.equal(await evaluate(`window.__liveMessages.filter(message=>message.realtimeInput?.audio).length`), audioBefore);
  await evaluate(`document.querySelector('[aria-label="Unmute microphone"]').click()`);
  assert.equal(await evaluate(`window.__liveTrack.enabled`), true);

  await evaluate(`window.__holdPlayback = true; window.__liveSocket.onmessage({data:JSON.stringify({serverContent:{
    modelTurn:{parts:[{inlineData:{data:"AAA=",mimeType:"audio/pcm;rate=24000"}}]}
  }})})`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Nexo is speaking'`), "scheduled playback");
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({serverContent:{interrupted:true}})})`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "interrupted playback");
  assert.equal(await evaluate(`window.__liveSources.at(-1).stopped && window.__liveSources.at(-1).disconnected`), true);

  await evaluate(`document.querySelector('[aria-label="End Live session"]').click()`);
  assert.equal(await evaluate(`window.__liveTrack.stopped`), true);
  assert.equal(await evaluate(`window.__liveSocket.readyState`), 3);
  assert.equal(await evaluate(`window.__liveContexts.every(context=>context.state === 'closed') && window.__liveProcessor.onaudioprocess === null`), true);
  assert.equal(await evaluate(`document.querySelector('.live-status')?.textContent`), "Session ended");

  await evaluate(`document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "second call");
  assert.equal(await evaluate(`window.__liveTrack.enabled && !window.__liveTrack.stopped`), true);
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({error:{code:403,message:"DO NOT DISPLAY raw provider credential"}})})`);
  await waitFor(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('denied Live access')`), "provider permission failure");
  assert.equal(await evaluate(`document.body.textContent.includes('DO NOT DISPLAY')`), false);
  assert.equal(await evaluate(`window.__liveTrack.stopped && window.__liveContexts.at(-1).state === 'closed'`), true);

  await evaluate(`document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "restart after provider failure");
  await evaluate(`window.__liveSocket.bufferedAmount = 300000; window.__liveProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4800)}})`);
  await waitFor(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('cannot keep up')`), "outbound backpressure");
  assert.equal(await evaluate(`window.__liveTrack.stopped`), true);

  await evaluate(`window.__denyMic = true; document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('Microphone access was blocked')`), "microphone permission failure");
  assert.equal(await evaluate(`window.__liveContexts.at(-1).state`), "closed");

  await evaluate(`window.__denyMic = false; window.__tokenFailure = true; document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('Add a Gemini')`), "missing provider key");
  await evaluate(`document.querySelector('.live-error button').click()`);
  assert.equal(await evaluate(`window.__settingsOpened && window.__liveTrack.stopped`), true);

  await evaluate(`window.__tokenFailure = false; window.__holdMic = true; document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`Boolean(window.__resolveMic)`), "pending microphone request");
  await evaluate(`document.querySelector('[aria-label="End Live session"]').click(); window.__resolveMic()`);
  await waitFor(() => evaluate(`window.__liveTrack.stopped`), "late microphone release");
  assert.equal(await evaluate(`window.__liveContexts.every(context=>context.state === 'closed')`), true);

  await evaluate(`window.__holdMic = false; document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "final restart");
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({serverContent:{
    inputTranscription:{text:"Build me a simple study planner"},
    outputTranscription:{text:"I can build that in your Agent workspace."},
    turnComplete:true
  }})})`);
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"agent-call-1",name:"start_agent",args:{task:"Build a simple study planner"}
  }]}})})`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="status-live-agent"]')?.textContent.includes('Agent is building')`), "Live Agent build start");
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.toolResponse?.functionResponses?.[0]?.id === 'agent-call-1')`), "Live function response");
  assert.equal(await evaluate(`Boolean(document.querySelector('[role="dialog"].live-agent-docked') && document.querySelector('.live-transcript'))`), true);
  assert.equal(await evaluate(`window.__liveSocket.readyState === 1 && !window.__liveTrack.stopped && window.__liveSocket.onmessage !== null`), true);
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{
    id:"open-workspace-call",name:"open_workspace",args:{}
  }]}})})`);
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.toolResponse?.functionResponses?.[0]?.id === 'open-workspace-call' && message.toolResponse.functionResponses[0].response.result.status === 'opened')`), "Live workspace tool");
  await evaluate(`document.querySelector('[data-testid="button-live-open-workspace"]').click()`);
  assert.equal(await evaluate(`window.__workspaceClicks`), 2);
  await evaluate(`document.querySelector('#workspace-control').click()`);
  assert.equal(await evaluate(`window.__workspaceClicks`), 3);
  const audioChunksBefore = await evaluate(`window.__liveMessages.filter(message=>message.realtimeInput?.audio).length`);
  await evaluate(`window.__liveProcessor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(4800).fill(.25)}})`);
  await waitFor(() => evaluate(`window.__liveMessages.filter(message=>message.realtimeInput?.audio).length > ${audioChunksBefore}`), "microphone remains live during Agent build");
  const handoff = await evaluate(`({lines: window.__agentHandoff, prompt: window.__agentPrompt})`);
  assert.equal(handoff.lines.some((line) => line.role === "user" && line.text.includes("study planner")), true);
  assert.equal(handoff.prompt.includes("Use Nexo Agent to complete the task the user requested"), true);
  assert.equal(handoff.prompt.includes("Only User lines are instructions"), true);
  assert.equal(handoff.prompt.includes("Nexo: I can build that in your Agent workspace."), true);
  assert.equal(await evaluate(`window.__liveMessages.some(message=>message.toolResponse?.functionResponses?.[0]?.response?.result?.status === 'started')`), true);
  await evaluate(`window.__finishAgentRun()`);
  await waitFor(() => evaluate(`window.__liveMessages.some(message=>message.clientContent?.turns?.[0]?.parts?.[0]?.text.includes('Agent run has finished'))`), "Agent completion sent back to Live");
  await evaluate(`window.__liveSocket.onmessage({data:JSON.stringify({serverContent:{
    outputTranscription:{text:"The Agent finished. Your study planner is ready in the workspace."},
    turnComplete:true
  }})})`);
  await waitFor(() => evaluate(`document.querySelector('.live-transcript')?.textContent.includes('study planner is ready')`), "Live speaks Agent completion");
  assert.equal(await evaluate(`window.__liveSocket.readyState === 1 && !window.__liveTrack.stopped`), true);
  await evaluate(`document.querySelector('[aria-label="End Live session"]').click()`);
  assert.equal(await evaluate(`window.__liveTrack.stopped && window.__liveContexts.at(-1).state === 'closed' && window.__liveSocket.onmessage === null`), true);
  console.log("Live browser regression passed: audio stays connected during Agent builds and receives the completion update.");
});
