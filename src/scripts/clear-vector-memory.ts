import { pool } from "../memory/checkpoint";

async function clearVectorMemory() {
  try {
    console.log("🧹 Conectando a PostgreSQL para borrar la memoria vectorial (recuerdos a largo plazo)...");
    
    // La tabla vectorial que configuramos se llama lucy_memory
    await pool.query(`
      TRUNCATE TABLE lucy_memory CASCADE;
    `);
    
    console.log("✅ ¡Memoria vectorial borrada exitosamente! Lucy ha olvidado todos los hechos a largo plazo.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error borrando la memoria vectorial:", error);
    process.exit(1);
  }
}

clearVectorMemory();
