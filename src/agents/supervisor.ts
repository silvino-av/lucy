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
    description: "Útil para pedirle al experto DevOps que revise infraestructura, discos, RAM o ejecute comandos en el servidor. Pásale una instrucción clara de lo que necesitas saber.",
    schema: z.object({
      instruction: z.string().describe("Instrucciones detalladas de lo que el experto DevOps debe investigar o hacer.")
    })
  }
);

const tools = [getCurrentTimeTool, askDevopsExpert];

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

  const channelContext = state.channel === "telegram"
    ? "Contexto de comunicación: Actualmente estás respondiendo a través de TELEGRAM. Usa formato amigable para móviles, puedes usar emojis, y asegúrate de usar Markdown simple (un solo asterisco * para negritas, NUNCA uses doble asterisco **)."
    : "Contexto de comunicación: Actualmente estás respondiendo a través de la TERMINAL DE COMANDOS (CLI). Tu formato debe ser muy limpio, tipo consola de Linux. Usa listas simples sin Markdown complejo y mantén las respuestas directas.";

  const systemPrompt = new SystemMessage(
    "Eres Lucy, una Inteligencia Artificial avanzada que actúa como orquestadora principal para Silvino.\n\n" +
    `${channelContext}\n\n` +
    "SIEMPRE que el usuario pregunte por la fecha, usa la herramienta correspondiente.\n" +
    "Si el usuario pide información técnica del servidor (almacenamiento, uptime, etc.), " +
    "USA LA HERRAMIENTA 'ask_devops_expert' para preguntarle al experto. Luego, resume su reporte para Silvino de forma amigable."
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
