import "dotenv/config";
import { pool } from "./pool.js";
import { schema } from "./schema.js";

async function migrate() {
  console.log("Running migrations...");
  await pool.query(schema);
  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
