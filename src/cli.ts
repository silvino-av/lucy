import { setupMemory } from "./memory/checkpoint";
import { supervisorAgent } from "./agents/supervisor";
import { HumanMessage } from "@langchain/core/messages";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function startCLI() {
  console.log("Inicializando memoria (PostgreSQL)...");
  await setupMemory();
  console.log("\n🤖 Lucy CLI iniciada. (Escribe 'salir' o 'exit' para terminar)");
  
  // Usamos un identificador fijo para el hilo de memoria de esta sesión de consola
  const threadId = "cli_session_1";

  const askQuestion = () => {
    rl.question("\nTú: ", async (input) => {
      if (input.toLowerCase() === "salir" || input.toLowerCase() === "exit") {
        console.log("¡Adiós!");
        rl.close();
        process.exit(0);
      }

      if (!input.trim()) {
        return askQuestion();
      }

      try {
        // Enviar mensaje al agente Supervisor de LangGraph
        const result = await supervisorAgent.invoke(
          { messages: [new HumanMessage(input)], channel: "terminal" },
          { configurable: { thread_id: threadId } }
        );

        // Extraer la última respuesta
        const finalMessage = result.messages[result.messages.length - 1];
        if (finalMessage && finalMessage.content) {
          console.log(`\nLucy: ${finalMessage.content}`);
        }
      } catch (error) {
        console.error("Error al comunicarse con el agente:", error);
      }

      // Volver a preguntar al usuario
      askQuestion();
    });
  };

  askQuestion();
}

startCLI().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
