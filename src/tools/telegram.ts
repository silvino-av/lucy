import { Telegraf } from "telegraf";
import { supervisorAgent } from "../agents/supervisor";
import { HumanMessage } from "@langchain/core/messages";

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim();

if (!token) {
  console.error("⚠️ TELEGRAM_BOT_TOKEN is missing in .env");
}

// Increase handlerTimeout because local "Thinking" models can take more than 90 seconds
export const bot = new Telegraf(token || "dummy-token", {
  handlerTimeout: 9_000_000,
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  // Security Check: Only process messages from the allowed Chat ID
  if (allowedChatId && chatId !== allowedChatId) {
    console.warn(`[Seguridad] Intento de acceso no autorizado del Chat ID: ${chatId}`);
    return;
  } else if (!allowedChatId) {
    console.warn(`⚠️ No has configurado TELEGRAM_ALLOWED_CHAT_ID en tu .env. Tu Chat ID actual es: ${chatId}. Configúralo para poder chatear.`);
    return; // Bloquea estrictamente si no está configurado
  }

  const text = ctx.message.text;

  try {
    // Show "typing..." indicator in Telegram
    await ctx.sendChatAction("typing");

    // Invoke the LangGraph Agent with the chat ID as the thread ID for memory
    const result = await supervisorAgent.invoke(
      { messages: [new HumanMessage(text)], channel: "telegram" },
      { configurable: { thread_id: chatId } }
    );

    // Extract the final response
    const finalMessage = result.messages[result.messages.length - 1];
    if (finalMessage && finalMessage.content) {
      let responseText = finalMessage.content as string;
      
      // Fix markdown formatting for Telegram (Telegram uses * for bold, LLMs use **)
      responseText = responseText.replace(/\*\*/g, '*');

      try {
        await ctx.reply(responseText, { parse_mode: 'Markdown' });
      } catch (parseError) {
        console.warn("Markdown parse failed, sending raw text instead...");
        await ctx.reply(responseText); // Fallback sin formato
      }
    }
  } catch (error) {
    console.error("Error processing telegram message:", error);
    await ctx.reply("Perdón, tuve un problema procesando tu mensaje.");
  }
});
