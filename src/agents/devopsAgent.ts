import { ChatOllama } from "@langchain/ollama";
import {
  StateGraph,
  START,
  END,
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { executeSSHCommandTool, listServersTool } from "../tools/ssh";
import { getServers } from "../config/servers";
import { SupervisorState } from "./state";

const devopsTools = [executeSSHCommandTool, listServersTool];

const model = new ChatOllama({
  model: process.env.OLLAMA_MODEL || "gemma4:cloud", 
  temperature: 0,
});

// Agent LLM Node
const devopsNode: GraphNode<typeof SupervisorState> = async (state) => {
  console.log("🛠️ [LangGraph] DevOps analizando la infraestructura...");
  
  const servers = getServers();
  const serverCatalog = servers.map(s => 
    `• [${s.id}] ${s.name} (${s.user}@${s.host})${s.description ? `: ${s.description}` : ""}${s.isDefault ? " [POR DEFECTO]" : ""}`
  ).join("\n");

  const systemPrompt = new SystemMessage(
    "Eres el Especialista DevOps de Lucy.\n" +
    "Te encargas de administrar los servidores remotos de Silvino vía SSH.\n\n" +
    "Catálogo de servidores disponibles:\n" +
    `${serverCatalog}\n\n` +
    "Reglas:\n" +
    "- SIEMPRE DEBES usar la herramienta 'execute_ssh_command' para ejecutar comandos en el servidor ANTES de dar una respuesta final.\n" +
    "- Usa el parámetro 'server' indicando el ID del servidor correspondiente (ej. 'principal', 'db'). Si no se menciona ningún servidor, usa el servidor por defecto.\n" +
    "- Si el usuario pregunta qué servidores tienes o qué infraestructura administras, usa la herramienta 'list_servers'.\n" +
    "- NUNCA inventes o asumas el estado de los servidores.\n" +
    "- Analiza bien los problemas antes de ejecutar comandos destructivos.\n" +
    "- Responde de manera clara y técnica."
  );

  const lastMessage = state.messages.at(-1);
  const isToolResult = lastMessage && ToolMessage.isInstance(lastMessage);

  let modelToUse;
  let currentPrompt;
  
  if (!isToolResult) {
    // Modo traductor para modelos locales
    currentPrompt = new SystemMessage(
      "ERES UNA MÁQUINA DE TRADUCCIÓN A COMANDOS BASH DE LINUX. NO ERES UN ASISTENTE.\n" +
      "TU ÚNICA TAREA ES LEER LO QUE PIDEN Y ESCRIBIR EL COMANDO BASH Y EL SERVIDOR DESTINO.\n\n" +
      "Catálogo de servidores:\n" +
      `${serverCatalog}\n\n` +
      "REGLAS ABSOLUTAS:\n" +
      "1. NUNCA respondas con lenguaje natural. NUNCA saludes.\n" +
      "2. NUNCA des explicaciones.\n" +
      "3. TU RESPUESTA DEBE SER ÚNICAMENTE EL COMANDO EN FORMATO: <ssh server=\"id_servidor\">comando</ssh> (o <ssh>comando</ssh> para el servidor por defecto).\n" +
      "4. Si el usuario pide listar o ver qué servidores hay, responde exactamente: <servers/>\n\n" +
      "EJEMPLOS:\n" +
      "Usuario: 'cuánto almacenamiento hay?' -> Respuesta: <ssh>df -h</ssh>\n" +
      "Usuario: 'revisa la RAM en el servidor de base de datos' -> Respuesta: <ssh server=\"db\">free -h</ssh>\n" +
      "Usuario: 'qué contenedores corren en principal?' -> Respuesta: <ssh server=\"principal\">docker ps</ssh>\n" +
      "Usuario: 'qué servidores tienes registrados?' -> Respuesta: <servers/>"
    );
    modelToUse = model.bindTools(devopsTools);
  } else {
    // Si ya ejecutamos el comando, restauramos personalidad experta para analizar la salida
    currentPrompt = systemPrompt;
    modelToUse = model;
  }

  const response = await modelToUse.invoke([currentPrompt, ...state.messages]);
  return { messages: [response] };
};

// Tool Execution Node
const devopsToolNode: GraphNode<typeof SupervisorState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (!lastMessage || !AIMessage.isInstance(lastMessage) || !lastMessage.tool_calls?.length) {
    return { messages: [] };
  }

  const result: ToolMessage[] = [];
  for (const toolCall of lastMessage.tool_calls) {
    const tool = devopsTools.find((t) => t.name === toolCall.name);
    if (tool) {
      const observation = await (tool as any).invoke(toolCall);
      result.push(observation);
    }
  }

  return { messages: result };
};

const shouldContinue: ConditionalEdgeRouter<{ InputSchema: typeof SupervisorState; Nodes: "devopsToolNode" }> = (state) => {
  const lastMessage = state.messages.at(-1);
  if (lastMessage && AIMessage.isInstance(lastMessage)) {
    // 1. Intentar llamadas de herramientas nativas (para modelos avanzados)
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      console.log(`🛠️ [LangGraph] DevOps llamó a la herramienta (Nativa): ${lastMessage.tool_calls[0]?.name}`);
      return "devopsToolNode";
    }

    // 2. Intentar parsear las etiquetas manuales XML (para modelos locales)
    const content = lastMessage.content ? lastMessage.content.toString() : "";
    
    // Soporte para <servers/>
    if (content.includes("<servers/>") || content.includes("<servers>")) {
      console.log(`🛠️ [LangGraph] DevOps solicitó listar servidores (Parseo Manual XML)`);
      lastMessage.tool_calls = [{
        name: "list_servers",
        args: {},
        id: "call_" + Math.random().toString(36).substring(2, 9),
        type: "tool_call"
      }];
      return "devopsToolNode";
    }

    // Soporte para <ssh server="id">comando</ssh> o <ssh>comando</ssh>
    const sshMatch = content.match(/<ssh(?:\s+server=["']([^"']+)["'])?>([\s\S]*?)<\/ssh>/i);
    if (sshMatch && sshMatch[2]) {
      const serverId = sshMatch[1]?.trim();
      const command = sshMatch[2].trim();
      console.log(`🛠️ [LangGraph] DevOps ejecutará comando: "${command}" en servidor: ${serverId || 'default'}`);
      
      lastMessage.tool_calls = [{
        name: "execute_ssh_command",
        args: { command, ...(serverId ? { server: serverId } : {}) },
        id: "call_" + Math.random().toString(36).substring(2, 9),
        type: "tool_call"
      }];
      
      return "devopsToolNode";
    }

    const prevMessage = state.messages.at(-2);
    const isSSHResult = prevMessage && ToolMessage.isInstance(prevMessage);
    if (!isSSHResult) {
      console.log(`🛠️ [LangGraph] ⚠️ DevOps respondió sin llamar a la herramienta. Intentó decir: "${content.trim() || "(Sin contenido)"}"`);
    } else {
      console.log(`🛠️ [LangGraph] DevOps generó su reporte técnico final para Lucy.`);
    }
  }
  
  return END;
};

// Build the sub-graph
export const devopsAgent = new StateGraph(SupervisorState)
  .addNode("devopsAgent", devopsNode)
  .addNode("devopsToolNode", devopsToolNode)
  .addEdge(START, "devopsAgent")
  .addConditionalEdges("devopsAgent", shouldContinue, ["devopsToolNode", END])
  .addEdge("devopsToolNode", "devopsAgent")
  .compile();
