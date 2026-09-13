import { ChatOllama } from "@langchain/ollama";
import {
  StateGraph,
  START,
  END,
  type GraphNode,
  type ConditionalEdgeRouter,
} from "@langchain/langgraph";
// Importamos ToolMessage para poder verificar el estado del historial
import { SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { executeSSHCommandTool } from "../tools/ssh";
import { SupervisorState } from "./state";

const devopsTools = [executeSSHCommandTool];

const model = new ChatOllama({
  model: process.env.OLLAMA_MODEL || "gemma4:cloud", 
  temperature: 0,
});

// Agent LLM Node
const devopsNode: GraphNode<typeof SupervisorState> = async (state) => {
  console.log("🛠️ [LangGraph] DevOps analizando la infraestructura...");
  
  const systemPrompt = new SystemMessage(
    "Eres el Especialista DevOps de Lucy.\n" +
    "Te encargas de administrar los servidores de Silvino vía SSH.\n" +
    "Reglas:\n" +
    "- SIEMPRE DEBES usar la herramienta 'execute_ssh_command' para ejecutar comandos en el servidor ANTES de dar una respuesta final.\n" +
    "- NUNCA inventes o asumas el estado del servidor. Si te preguntan por almacenamiento, usa 'df -h'.\n" +
    "- Analiza bien los problemas antes de ejecutar comandos destructivos.\n" +
    "- Tienes acceso a ejecutar comandos en la terminal remota.\n" +
    "- Responde de manera clara y técnica."
  );

  const lastMessage = state.messages.at(-1);
  const isSSHResult = lastMessage && ToolMessage.isInstance(lastMessage) && lastMessage.name === "execute_ssh_command";

  let modelToUse;
  let currentPrompt;
  
  if (!isSSHResult) {
    // Si NO venimos de ejecutar el comando SSH, el modelo se porta como un simple traductor a bash.
    // Esto evita que los modelos locales intenten "hablar" y alucinar respuestas.
    currentPrompt = new SystemMessage(
      "ERES UNA MÁQUINA DE TRADUCCIÓN A COMANDOS BASH DE LINUX. NO ERES UN ASISTENTE.\n" +
      "TU ÚNICA TAREA ES LEER LO QUE PIDEN Y ESCRIBIR EL COMANDO BASH NECESARIO.\n\n" +
      "REGLAS ABSOLUTAS:\n" +
      "1. NUNCA respondas con lenguaje natural. NUNCA saludes.\n" +
      "2. NUNCA des explicaciones.\n" +
      "3. TU RESPUESTA DEBE SER ÚNICAMENTE EL COMANDO ENCERRADO EN ETIQUETAS <ssh> y </ssh>.\n\n" +
      "EJEMPLOS:\n" +
      "Usuario: 'cuánto almacenamiento hay?' -> Respuesta: <ssh>df -h</ssh>\n" +
      "Usuario: 'ejecuta el comando uptime' -> Respuesta: <ssh>uptime</ssh>\n" +
      "Usuario: 'reinicia el servicio nginx' -> Respuesta: <ssh>sudo systemctl restart nginx</ssh>"
    );
    modelToUse = model.bindTools(devopsTools);
  } else {
    // Si YA ejecutamos el comando, le restauramos su personalidad de experto DevOps para que analice la salida.
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
      const observation = await tool.invoke(toolCall);
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

    // 2. Intentar parsear las etiquetas manuales <ssh> (para modelos locales tercos)
    const content = lastMessage.content ? lastMessage.content.toString() : "";
    const sshMatch = content.match(/<ssh>([\s\S]*?)<\/ssh>/i);
    
    if (sshMatch && sshMatch[1]) {
      const command = sshMatch[1].trim();
      console.log(`🛠️ [LangGraph] DevOps llamó a la herramienta (Parseo Manual XML): ${command}`);
      
      // Inyectamos la llamada de herramienta al mensaje para que el sistema lo procese como si fuera nativo
      lastMessage.tool_calls = [{
        name: "execute_ssh_command",
        args: { command: command },
        id: "call_" + Math.random().toString(36).substring(2, 9),
        type: "tool_call"
      }];
      
      return "devopsToolNode";
    }

    const prevMessage = state.messages.at(-2);
    const isSSHResult = prevMessage && ToolMessage.isInstance(prevMessage) && prevMessage.name === "execute_ssh_command";
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
