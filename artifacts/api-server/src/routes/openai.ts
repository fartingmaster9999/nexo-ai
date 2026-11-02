import { Router, type IRouter } from "express";
import { StreamOpenaiChatBody } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.post("/openai/chat", async (req, res): Promise<void> => {
  const parsed = StreamOpenaiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid conversation." });
    return;
  }

  const controller = new AbortController();
  const abortOnDisconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", abortOnDisconnect);

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful, clear, and thoughtful assistant. Give direct answers, organize longer responses for readability, and ask a brief follow-up only when needed.",
        },
        ...parsed.data.messages,
      ],
      stream: true,
    }, { signal: controller.signal });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    req.log.error({ err: error }, "OpenAI chat request failed");
    if (res.headersSent && !res.destroyed && !res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({ error: "The AI could not reply. Please try again." })}\n\n`,
      );
      res.end();
      return;
    }

    res.status(502).json({ error: "The AI could not reply. Please try again." });
  } finally {
    res.off("close", abortOnDisconnect);
  }
});

export default router;
