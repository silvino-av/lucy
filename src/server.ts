import { Hono } from "hono";
import { setupMemory } from "./memory/checkpoint";
import { setupVectorStore } from "./memory/vector";
import { bot } from "./tools/telegram";

// Initialize memory and vector store before accepting requests
setupMemory()
  .then(() => setupVectorStore())
  .then(() => {
    // Once memory is ready, start polling for Telegram messages
    if (process.env.TELEGRAM_BOT_TOKEN) {
      bot.launch();
      console.log("✅ Telegram Bot polling started.");
    }
  })
  .catch(console.error);

// Enable graceful stop for Telegram bot
import { HumanMessage } from "@langchain/core/messages";
import { supervisorAgent } from "./agents/supervisor";

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

const app = new Hono();

// Health check endpoint
app.get("/", (c) => {
  return c.text("Lucy Super Agent API & Bot are running!");
});

// Chat endpoint for Mobile App
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json();
    const { text, thread_id } = body;

    if (!text) {
      return c.json({ error: "No text provided" }, 400);
    }

    // Default thread ID if not provided by the app
    const threadId = thread_id || "mobile-default-user";

    // Invoke LangGraph
    const result = await supervisorAgent.invoke(
      { messages: [new HumanMessage(text)], channel: "mobile" },
      { configurable: { thread_id: threadId } }
    );

    const finalMessage = result.messages[result.messages.length - 1];
    const responseText = finalMessage && finalMessage.content ? finalMessage.content.toString() : "Lo siento, no pude procesar tu mensaje.";

    return c.json({ response: responseText });
  } catch (error: any) {
    console.error("❌ Error en /api/chat:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Start the server using Bun's native HTTP server
export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
