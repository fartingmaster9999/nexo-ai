import assert from "node:assert/strict";
import { withFixture, waitFor } from "./browser-harness.mjs";

await withFixture("tests/live-voice.html", async ({ evaluate }) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('[role="dialog"] .live-start-button'))`), "Live dialog");
  await evaluate(`document.querySelector('.live-start-button').click()`);
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "Live connection setup");

  const protocol = await evaluate(`({
    url: window.__liveUrl,
    setup: window.__liveMessages?.[0],
    hasToken: window.__liveUrl?.includes('access_token=test-ephemeral-token')
  })`);
  assert.match(protocol.url, /BidiGenerateContentConstrained/);
  assert.equal(protocol.hasToken, true);
  assert.equal(protocol.setup.setup.generationConfig.responseModalities[0], "AUDIO");

  await evaluate(`window.__liveSocket.onmessage({data: JSON.stringify({serverContent:{
    inputTranscription:{text:"Hello Nexo"},
    outputTranscription:{text:"Hi there"},
    modelTurn:{parts:[{inlineData:{data:"AAAA",mimeType:"audio/pcm;rate=24000"}}]},
    turnComplete:true
  }})})`);
  await waitFor(() => evaluate(`document.querySelector('.live-transcript')?.textContent.includes('Hello Nexo') && document.querySelector('.live-transcript')?.textContent.includes('Hi there')`), "Live transcript");
  await waitFor(() => evaluate(`document.querySelector('.live-status')?.textContent === 'Listening'`), "audio playback completion");

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

  await evaluate(`document.querySelector('[aria-label="End Live session"]').click()`);
  assert.equal(await evaluate(`window.__liveTrack.stopped`), true);
  assert.equal(await evaluate(`window.__liveSocket.readyState`), 3);
  assert.equal(await evaluate(`document.querySelector('.live-status')?.textContent`), "Session ended");
});
