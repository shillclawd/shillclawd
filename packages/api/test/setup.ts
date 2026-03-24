import { pool } from "../src/db/pool.js";
import { schema } from "../src/db/schema.js";

export async function setupDatabase() {
  // Drop and recreate for clean test runs
  await pool.query(`
    DROP TABLE IF EXISTS notifications, ratings, deliveries, applications, gigs, agents CASCADE
  `);
  await pool.query(schema);
}

export async function cleanDatabase() {
  await pool.query(`
    TRUNCATE notifications, ratings, deliveries, applications, gigs, agents CASCADE
  `);
}

export async function teardownDatabase() {
  await pool.end();
}
