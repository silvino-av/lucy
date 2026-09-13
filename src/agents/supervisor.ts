import { ChatOllama } from "@langchain/ollama";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { checkpointer } from "../memory/checkpoint";

// Import Tools
import { getCurrentTimeTool } from "../tools/time";

const tools = [getCurrentTimeTool];

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Define the state for the supervisor graph
export const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  channel: Annotation<string>({
    reducer: (left?: string, right?: string) => right ?? left ?? "terminal",
    default: () => "terminal",
  })
});

// Model Configuration
const model = new ChatOllama({
  model: process.env.OLLAMA_MODEL || "gemma4:cloud", 
  temperature: 0,
});

// Bind tools to the model
const modelWithTools = model.bindTools(tools);

// Supervisor Node (LLM Call)
const supervisorNode: GraphNode<typeof SupervisorState> = async (state) => {
  const channelContext = state.channel === "telegram"
    ? "Contexto de comunicación: Actualmente estás respondiendo a través de TELEGRAM. Usa formato amigable para móviles, puedes usar emojis, y asegúrate de usar Markdown simple (un solo asterisco * para negritas, NUNCA uses doble asterisco **)."
    : "Contexto de comunicación: Actualmente estás respondiendo a través de la TERMINAL DE COMANDOS (CLI). Tu formato debe ser muy limpio, tipo consola de Linux. Usa listas simples sin Markdown complejo y mantén las respuestas directas.";

  const systemPrompt = new SystemMessage(
    "Eres Lucy, una Inteligencia Artificial avanzada que actúa como asistente personal " +
    "y orquestadora de sistemas para Silvino.\n\n" +
    `${channelContext}\n\n` +
    "SIEMPRE que el usuario pregunte por la fecha, la hora, o 'qué día es', usa la " +
    "herramienta proporcionada para averiguarlo antes de responder."
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
      const observation = await tool.invoke(toolCall);
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
