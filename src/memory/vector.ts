import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { OllamaEmbeddings } from "@langchain/ollama";
import { pool } from "./checkpoint";

// Configuración del modelo de Embeddings usando Ollama local
const embeddings = new OllamaEmbeddings({
  model: process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
});

let vectorStore: PGVectorStore | null = null;

export async function setupVectorStore() {
  if (vectorStore) return;
  console.log("🔄 Inicializando memoria vectorial en PostgreSQL...");
  try {
    vectorStore = await PGVectorStore.initialize(embeddings, {
      pool: pool,
      tableName: "lucy_memory",
      columns: {
        idColumnName: "id",
        vectorColumnName: "embedding",
        contentColumnName: "text",
        metadataColumnName: "metadata",
      },
    });
    console.log("✅ Memoria vectorial (pgvector) inicializada exitosamente.");
  } catch (error) {
    console.error("❌ Error inicializando pgvector. ¿Está instalada la extensión en tu DB?", error);
  }
}

// Herramienta para guardar recuerdos
export const saveMemoryTool = tool(
  async ({ memory, importance }) => {
    if (!vectorStore) return "Error: La memoria vectorial no está inicializada.";
    try {
      await vectorStore.addDocuments([
        {
          pageContent: memory,
          metadata: { 
            importance, 
            timestamp: new Date().toISOString() 
          },
        },
      ]);
      return `Recuerdo guardado exitosamente en la memoria a largo plazo. (Importancia: ${importance}/5)`;
    } catch (error: any) {
      return `Error al guardar el recuerdo: ${error.message}`;
    }
  },
  {
    name: "save_memory",
    description: "Útil para guardar hechos, configuraciones, reglas o preferencias importantes del usuario a largo plazo. Úsala de forma proactiva cuando el usuario te dé información que debas recordar a futuro.",
    schema: z.object({
      memory: z.string().describe("El texto claro y detallado que deseas recordar."),
      importance: z.number().min(1).max(5).describe("Importancia del recuerdo del 1 al 5 (1=Trivial, 5=Crítico)."),
    }),
  }
);

// Herramienta para buscar recuerdos
export const searchMemoryTool = tool(
  async ({ query }) => {
    if (!vectorStore) return "Error: La memoria vectorial no está inicializada.";
    try {
      const results = await vectorStore.similaritySearch(query, 3); // Obtiene los 3 más relevantes
      
      if (results.length === 0) {
        return "No encontré recuerdos relacionados a esa consulta.";
      }

      const formattedResults = results
        .map((doc, idx) => `[${idx + 1}] ${doc.pageContent}`)
        .join("\n");
        
      return `Recuerdos encontrados:\n${formattedResults}`;
    } catch (error: any) {
      return `Error al buscar recuerdos: ${error.message}`;
    }
  },
  {
    name: "search_memory",
    description: "Útil para consultar tu base de datos de recuerdos a largo plazo. Úsala si el usuario pregunta algo sobre su infraestructura pasada, preferencias, IPs o cosas que no están en el historial reciente.",
    schema: z.object({
      query: z.string().describe("La pregunta o frase clave para buscar en tu memoria (ej. '¿Cuál es la IP de la base de datos?')."),
    }),
  }
);
