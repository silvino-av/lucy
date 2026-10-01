import { ChatOllama } from "@langchain/ollama";
import {
  StateGraph,
  START,
  END,
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { checkpointer } from "../memory/checkpoint";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { SupervisorState } from "./state";

import { HumanMessage } from "@langchain/core/messages";

// Import Sub-Agents & Tools
import { getCurrentTimeTool } from "../tools/time";
import { devopsAgent } from "./devopsAgent";
import { saveMemoryTool, searchMemoryTool } from "../memory/vector";

// Handoff Tool (Agent as a Tool)
const askDevopsExpert = tool(
  async ({ instruction }) => {
    console.log(`\n[Supervisor] 📡 Consultando a DevOps: "${instruction}"...`);
    
    // Invocamos al sub-agente DevOps de manera aislada (sin contaminar la memoria principal)
    const result = await devopsAgent.invoke({
      messages: [new HumanMessage(instruction)],
      channel: "terminal" // Puede ser terminal o telegram, no afecta tanto a DevOps
    });
    
    const finalMsg = result.messages.at(-1);
    return finalMsg ? finalMsg.content.toString() : "No hubo respuesta de DevOps.";
  },
  {
    name: "ask_devops_expert",
    description: "Útil para pedirle al experto DevOps que revise infraestructura, discos, RAM, contenedores Docker o ejecute comandos en los servidores de Silvino (soporta múltiples servidores como principal, db, etc., o listar qué servidores hay). Pásale una instrucción clara.",
    schema: z.object({
      instruction: z.string().describe("Instrucciones detalladas de lo que el experto DevOps debe investigar o hacer, incluyendo el servidor si se especifica.")
    })
  }
);

const tools = [getCurrentTimeTool, askDevopsExpert, saveMemoryTool, searchMemoryTool];

// Model Configuration
const model = new ChatOllama({
  model: process.env.OLLAMA_MODEL || "gemma4:cloud",
  verbose: true,
  temperature: 0,
});

// Bind tools to the model
const modelWithTools = model.bindTools(tools);

// Supervisor Node (LLM Call)
const supervisorNode: GraphNode<typeof SupervisorState> = async (state) => {
  console.log("🤖 [LangGraph] Supervisor analizando la petición...");

  let channelContext = "";
  if (state.channel === "telegram") {
    channelContext = "Contexto de comunicación: Actualmente estás respondiendo a través de TELEGRAM por mensaje de texto. Usa formato amigable para móviles, puedes usar emojis, y asegúrate de usar Markdown simple (un solo asterisco * para negritas, NUNCA uses doble asterisco **).";
  } else if (state.channel === "telegram_audio") {
    channelContext = "Contexto de comunicación: Actualmente estás respondiendo por NOTA DE VOZ (AUDIO) en Telegram. Tu respuesta DEBE ser MUY DIRECTA, CONCISA Y BREVE (máximo 1 o 2 oraciones). Ve directo al grano sin introducciones ni rodeos. Es CRÍTICO que generes texto PLANO: NO uses emojis, NO uses Markdown (* o _), NO uses viñetas ni caracteres especiales. Habla de forma natural y concisa.";
  } else if (state.channel === "mobile") {
    channelContext = "Contexto de comunicación: Actualmente estás respondiendo a través de una APP MÓVIL NATIVA (React Native). Usa formato súper amigable, cercano y moderno, puedes usar emojis, y asegúrate de usar Markdown simple.";
  } else if (state.channel === "mobile_audio") {
    channelContext = "Contexto de comunicación: Actualmente estás respondiendo por VOZ (AUDIO) en la APP MÓVIL. Tu respuesta DEBE ser MUY DIRECTA, CONCISA Y BREVE (máximo 1 o 2 oraciones). Ve directo al grano sin introducciones ni rodeos. Es CRÍTICO que generes texto PLANO: NO uses emojis, NO uses Markdown (* o _), NO uses viñetas ni caracteres especiales. Habla de forma natural y concisa.";
  } else {
    channelContext = "Contexto de comunicación: Actualmente estás respondiendo a través de la TERMINAL DE COMANDOS (CLI). Tu formato debe ser muy limpio, tipo consola de Linux. Usa listas simples sin Markdown complejo y mantén las respuestas directas.";
  }

  const isAudioChannel = state.channel === "telegram_audio" || state.channel === "mobile_audio";
  const lengthInstruction = isAudioChannel
    ? "REGLA ESTRICTA DE VOZ: Sé sumamente concisa. Responde en máximo 1 o 2 oraciones directas. NUNCA des explicaciones largas ni introducciones de relleno en mensajes de voz."
    : "Mantén respuestas claras y bien estructuradas.";

  const systemPrompt = new SystemMessage(
    "Eres Lucy, una Inteligencia Artificial avanzada que actúa como orquestadora principal para Silvino.\n\n" +
    `${channelContext}\n\n` +
    `${lengthInstruction}\n\n` +
    "SIEMPRE que el usuario pregunte por la fecha, usa la herramienta correspondiente.\n" +
    "Si el usuario pide información técnica del servidor (almacenamiento, uptime, etc.), " +
    "USA LA HERRAMIENTA 'ask_devops_expert' para preguntarle al experto.\n" +
    "Tienes memoria a largo plazo: Usa 'save_memory' para guardar hechos importantes, y 'search_memory' para recordar el pasado."
  );

  const response = await modelWithTools.invoke([systemPrompt, ...state.messages]);
  return { messages: [response] };
};

// Tool Execution Node
const toolNode: GraphNode<typeof SupervisorState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
    return { messages: [] };
  }

  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls) {
    const tool = tools.find((t) => t.name === toolCall.name);
    if (tool) {
      const observation = await (tool as any).invoke(toolCall);
      result.push(observation);
    }
  }

  return { messages: result };
};

// Logic to determine if we should execute tools or end
const shouldContinue: ConditionalEdgeRouter<{ InputSchema: typeof SupervisorState; Nodes: "toolNode" }> = (state) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
    return "toolNode";
  }

  return END;
};

// Build and compile the Supervisor Graph
export const supervisorAgent = new StateGraph(SupervisorState)
  .addNode("supervisor", supervisorNode)
  .addNode("toolNode", toolNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "supervisor")
  .compile({ checkpointer });
