import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

// Create a Postgres connection pool
// IMPORTANT: Make sure to set DATABASE_URL in your .env file
// Example: DATABASE_URL="postgresql://user:password@localhost:5432/lucy_db"
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on("error", (err) => {
  console.error("⚠️ [Postgres Pool] Error inesperado en cliente inactivo:", err);
});

// Create the checkpointer instance
export const checkpointer = new PostgresSaver(pool);

// Ensure the necessary tables exist in the database with automatic retries
export async function setupMemory(retries = 15, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Conectando a PostgreSQL... (intento ${attempt}/${retries})`);
      
      // Probar conexión antes de configurar tablas
      const client = await pool.connect();
      client.release();

      await checkpointer.setup();
      console.log("✅ PostgreSQL Checkpointer ready (tables verified).");
      return;
    } catch (error: any) {
      if (attempt === retries) {
        console.error("❌ Error setting up PostgreSQL Checkpointer tras varios intentos:", error);
        throw error;
      }
      console.warn(`⏳ PostgreSQL aún no está listo (${error.message || error.code}). Reintentando en ${delayMs / 1000}s...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}
