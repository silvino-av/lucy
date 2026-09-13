import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import "dotenv/config";

// Create a Postgres connection pool
// IMPORTANT: Make sure to set DATABASE_URL in your .env file
// Example: DATABASE_URL="postgresql://user:password@localhost:5432/lucy_db"
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Create the checkpointer instance
export const checkpointer = new PostgresSaver(pool);

// Ensure the necessary tables exist in the database
export async function setupMemory() {
  try {
    await checkpointer.setup();
    console.log("✅ PostgreSQL Checkpointer ready (tables verified).");
  } catch (error) {
    console.error("❌ Error setting up PostgreSQL Checkpointer:", error);
    throw error;
  }
}
