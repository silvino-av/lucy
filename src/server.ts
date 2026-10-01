import { Hono } from "hono";
import { setupMemory } from "./memory/checkpoint";
import { setupVectorStore } from "./memory/vector";
import { bot, token } from "./tools/telegram";

// Initialize memory and vector store before accepting requests
setupMemory()
  .then(() => setupVectorStore())
  .then(() => {
    // Once memory is ready, start polling for Telegram messages if token is valid
    if (token && !token.includes("tu_token") && token !== "dummy-token") {
      bot.launch()
        .then(() => {
          console.log("✅ Telegram Bot polling started.");
        })
        .catch((err) => {
          console.error("❌ Error al iniciar el bot de Telegram:", err.message || err);
          console.error("👉 Revisa tu TELEGRAM_BOT_TOKEN en las variables de entorno. Debe ser el token puro sin comillas ni espacios.");
        });
    } else {
      console.log("ℹ️ Telegram Bot omitido: TELEGRAM_BOT_TOKEN no configurado o tiene valor por defecto.");
    }
  })
  .catch(console.error);

// Enable graceful stop for Telegram bot
import { HumanMessage } from "@langchain/core/messages";
import { supervisorAgent } from "./agents/supervisor";
import { AudioService } from "./services/audio";

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

// Audio Chat endpoint for Mobile App
app.post("/api/chat/audio", async (c) => {
  try {
    const formData = await c.req.parseBody();
    const audioFile = formData["audio"];
    const threadId = (formData["thread_id"] as string) || "mobile-default-user";

    if (!audioFile || typeof audioFile === 'string') {
      return c.json({ error: "No audio file provided" }, 400);
    }

    const arrayBuffer = await (audioFile as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Transcribe (STT)
    const transcription = await AudioService.transcribe(buffer);
    
    // 2. Invoke LangGraph (usando mobile_audio para texto plano conversacional)
    const result = await supervisorAgent.invoke(
      { messages: [new HumanMessage(transcription)], channel: "mobile_audio" },
      { configurable: { thread_id: threadId } }
    );

    const finalMessage = result.messages[result.messages.length - 1];
    let responseText = "No pude procesar tu mensaje.";
    let audioBase64 = "";

    if (finalMessage && finalMessage.content) {
      responseText = finalMessage.content.toString();
      
      // 3. Generate voice (TTS)
      const audioBuffer = await AudioService.speak(responseText);
      audioBase64 = audioBuffer.toString("base64");
    }

    return c.json({ 
      response: responseText, 
      transcription: transcription,
      audioBase64: audioBase64 
    });
  } catch (error: any) {
    console.error("❌ Error en POST /api/chat/audio:", error);
    return c.json({ error: error.message }, 500);
  }
});

// TTS on-demand endpoint for Mobile App
app.post("/api/tts", async (c) => {
  try {
    const body = await c.req.json();
    const { text } = body;
    if (!text || typeof text !== 'string') {
      return c.json({ error: "No text provided" }, 400);
    }
    const audioBuffer = await AudioService.speak(text);
    return c.json({ audioBase64: audioBuffer.toString("base64") });
  } catch (error: any) {
    console.error("❌ Error en POST /api/tts:", error);
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
