import { Telegraf } from "telegraf";
import { supervisorAgent } from "../agents/supervisor";
import { HumanMessage } from "@langchain/core/messages";
import fs from "fs/promises";
import path from "path";
import os from "os";

const rawToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
export const token = rawToken.replace(/^["']|["']$/g, "").trim();

const rawChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim() || "";
const allowedChatId = rawChatId.replace(/^["']|["']$/g, "").trim();

if (!token || token.includes("tu_token")) {
  console.warn("⚠️ TELEGRAM_BOT_TOKEN is missing or contains placeholder in environment variables.");
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

// Soporte para Notas de Voz
bot.on("voice", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  if (allowedChatId && chatId !== allowedChatId) return;

  try {
    await ctx.sendChatAction("record_voice");

    // 1. Obtener el archivo de Telegram
    const fileId = ctx.message.voice.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    
    // 2. Descargar el archivo
    const response = await fetch(fileLink.toString());
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Transcribir Audio (STT)
    const { AudioService } = await import("../services/audio");
    const transcription = await AudioService.transcribe(buffer);
    
    await ctx.reply(`*Escuché:* _"${transcription}"_`, { parse_mode: 'Markdown' });
    await ctx.sendChatAction("typing");

    // 4. Procesar por LangGraph (marcado como audio para que la IA hable fluido y sin emojis)
    const result = await supervisorAgent.invoke(
      { messages: [new HumanMessage(transcription)], channel: "telegram_audio" },
      { configurable: { thread_id: chatId } }
    );

    const finalMessage = result.messages[result.messages.length - 1];
    if (finalMessage && finalMessage.content) {
      const responseText = (finalMessage.content as string).replace(/\*\*/g, '*');
      
      // 5. Generar Audio de vuelta (TTS) en formato OGG
      await ctx.sendChatAction("record_voice");
      const audioBuffer = await AudioService.speak(responseText, 'ogg');
      
      // 6. Enviar mensaje de voz de Lucy + el texto usando fetch manual y Blob
      // (Bypass de bug ECONNRESET en Telegraf + Bun al enviar archivos)
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('voice', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
        
        const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVoice`, {
          method: 'POST',
          body: formData as any
        });
        
        if (!response.ok) {
           console.error("Telegram API Error:", await response.text());
        }
      } catch (voiceError) {
        console.error("Failed to send voice via fetch:", voiceError);
      }
      
      await ctx.reply(responseText, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error("Error processing voice message:", error);
    await ctx.reply("No pude escuchar bien tu audio. Recuerda instalar ffmpeg en el servidor.");
  }
});
