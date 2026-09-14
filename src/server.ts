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
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// const app = new Hono();

// // Health check endpoint
// app.get("/", (c) => {
//   return c.text("Lucy Super Agent API & Bot are running!");
// });

// // Start the server using Bun's native HTTP server
// export default {
//   port: process.env.PORT || 3000,
//   fetch: app.fetch,
// };
