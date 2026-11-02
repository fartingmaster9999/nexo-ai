import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { StreamChatBody } from "@workspace/api-zod";
import { buildChatRequest, CHAT_MODEL } from "../lib/chat-request";

const router: IRouter = Router();

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = StreamChatBody.safeParse(req.body);
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") {
    res.status(400).json({ error: "Please provide a valid conversation ending with your message." });
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({ error: "Groq is not configured. Add GROQ_API_KEY to enable Nexo AI." });
    return;
  }

  // Fixed Groq host: no provider override, OpenAI client, or fallback.
  const client = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com",
    timeout: 120000,
    maxRetries: 2,
  });
  const controller = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", abortOnDisconnect);
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  try {
    const request = buildChatRequest(parsed.data);
    const stream = await client.chat.completions.create(request, { signal: controller.signal });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ provider: "groq", model: CHAT_MODEL, reasoningEffort: request.reasoning_effort })}\n\n`);
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": keepalive\n\n");
    }, 15000);

    let hasContent = false;
    let finishReason: string | null = null;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        hasContent = true;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
    if (!hasContent) throw new Error("Empty Groq completion");
    if (finishReason === "length") {
      res.write(`data: ${JSON.stringify({ error: "The response reached its length limit. Ask Nexo AI to continue." })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    }
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
    const status = error instanceof Groq.APIError ? error.status : undefined;
    // Do not log SDK errors wholesale: request headers can contain credentials.
    req.log.error({ provider: "groq", status }, "Groq chat request failed");
    const message = status === 429
      ? "Groq's usage limit was reached. Please wait briefly and try again."
      : status === 401 || status === 403
        ? "Groq could not authorize this request. Check the server's Groq API key and model access."
        : "Groq could not complete the response. Please try again.";
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    } else {
      res.status(status === 429 ? 429 : 502).json({ error: message });
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    res.off("close", abortOnDisconnect);
  }
});

export default router;
