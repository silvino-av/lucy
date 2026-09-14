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
    console.error("❌ Error en POST /api/chat:", error);
    return c.json({ error: error.message }, 500);
  }
});

// History endpoint for Mobile App
app.get("/api/chat/:thread_id", async (c) => {
  try {
    const threadId = c.req.param("thread_id");
    
    const state = await supervisorAgent.getState({ configurable: { thread_id: threadId } });
    const messages = state.values?.messages || [];

    const formattedMessages = messages
      .filter((m: any) => m._getType() === "human" || m._getType() === "ai")
      .map((m: any, index: number) => {
        // Ignorar mensajes de herramientas internas para no mostrar JSONs en la app
        if (m._getType() === "ai" && m.tool_calls && m.tool_calls.length > 0 && !m.content) {
          return null; 
        }
        return {
          id: `history-${index}`,
          text: m.content.toString(),
          sender: m._getType() === "human" ? "user" : "lucy"
        };
      })
      .filter(Boolean); // Remover nulls

    if (formattedMessages.length === 0) {
      // Default greeting if no history
      formattedMessages.push({
        id: 'default-1',
        text: '¡Hola! Soy Lucy 🤖. ¿En qué puedo ayudarte hoy?',
        sender: 'lucy'
      });
    }

    return c.json({ messages: formattedMessages });
  } catch (error: any) {
    console.error("❌ Error en GET /api/chat/:thread_id:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Start the server using Bun's native HTTP server
export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
