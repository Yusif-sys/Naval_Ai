import { ensureSchema, pool } from "../lib/db";

async function main() {
  try {
    await ensureSchema();
    // eslint-disable-next-line no-console
    console.log("Database schema ensured.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Migration failed", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();

