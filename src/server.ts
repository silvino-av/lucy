import { Hono } from "hono";
import { setupMemory } from "./memory/checkpoint";
import { supervisorAgent } from "./agents/supervisor";
import { HumanMessage } from "@langchain/core/messages";
import { sendTelegramMessage } from "./tools/telegram";

// Initialize memory (tables) before accepting requests
setupMemory().catch(console.error);

const app = new Hono();

// Health check endpoint
app.get("/", (c) => {
  return c.text("Lucy Super Agent API is running!");
});

// Endpoint to receive Telegram updates via Webhook
app.post("/webhook/telegram", async (c) => {
  try {
    const body = await c.req.json();
    console.log("Received Telegram Webhook:", JSON.stringify(body, null, 2));

    const message = body.message;
    if (message && message.text) {
      const chatId = message.chat.id;
      const text = message.text;

      // Invoke the LangGraph Agent with the chat ID as the thread ID for memory
      const result = await supervisorAgent.invoke(
        { messages: [new HumanMessage(text)] },
        { configurable: { thread_id: chatId.toString() } }
      );

      // Get the last message from the agent's response
      const finalMessage = result.messages[result.messages.length - 1];
      
      // Send the response back to Telegram
      if (finalMessage && finalMessage.content) {
        await sendTelegramMessage(chatId, finalMessage.content as string);
      }
    }
    
    return c.text("OK");
  } catch (error) {
    console.error("Error processing webhook:", error);
    return c.text("Internal Server Error", 500);
  }
});

// Start the server using Bun's native HTTP server
export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
