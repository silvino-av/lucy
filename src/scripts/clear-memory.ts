import { pool } from "../memory/checkpoint";

async function clearMemory() {
  try {
    console.log("🧹 Conectando a PostgreSQL para borrar la memoria...");
    
    // LangGraph-checkpoint-postgres usa estas 3 tablas para guardar el historial
    await pool.query(`
      TRUNCATE TABLE checkpoints CASCADE;
      TRUNCATE TABLE checkpoint_blobs CASCADE;
      TRUNCATE TABLE checkpoint_writes CASCADE;
    `);
    
    console.log("✅ ¡Memoria borrada exitosamente! Lucy ya no recordará el contexto de las conversaciones anteriores.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error borrando la memoria:", error);
    process.exit(1);
  }
}

clearMemory();
