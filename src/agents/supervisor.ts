import { ChatOllama } from "@langchain/ollama";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  START,
  END,
  type GraphNode,
} from "@langchain/langgraph";
import { SystemMessage } from "@langchain/core/messages";
import { checkpointer } from "../memory/checkpoint";

// Define the state for the supervisor graph
export const SupervisorState = new StateSchema({
  messages: MessagesValue,
});

// Model Configuration
const model = new ChatOllama({
  model: process.env.OLLAMA_MODEL || "gemma4:cloud", 
  temperature: 0,
});

// Supervisor Node
const supervisorNode: GraphNode<typeof SupervisorState> = async (state) => {
  const systemPrompt = new SystemMessage(
    "Eres Lucy, una Inteligencia Artificial avanzada que actúa como asistente personal " +
    "y orquestadora de sistemas para Silvino. Tienes acceso a la domótica del hogar, " +
    "servidores mediante SSH, y un CRM/aplicaciones de tareas.\n\n" +
    "En esta fase inicial, aún no tienes las herramientas conectadas, pero debes " +
    "responder amablemente y estar preparada para recibir instrucciones."
  );

  const response = await model.invoke([systemPrompt, ...state.messages]);
  
  return { messages: [response] };
};

// Build and compile the Supervisor Graph
export const supervisorAgent = new StateGraph(SupervisorState)
  .addNode("supervisor", supervisorNode)
  .addEdge(START, "supervisor")
  .addEdge("supervisor", END)
  .compile({ checkpointer });
