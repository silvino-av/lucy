export async function sendTelegramMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not set.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    if (!response.ok) {
      console.error("Failed to send message to Telegram:", await response.text());
    }
  } catch (error) {
    console.error("Error sending message to Telegram:", error);
  }
}
