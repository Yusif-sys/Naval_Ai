import { Pool } from "pg";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config(); // fallback to .env

const connectionString =
  process.env.DATABASE_URL ??
  `postgresql://${process.env.POSTGRES_USER ?? "naval"}:${process.env
    .POSTGRES_PASSWORD ?? "naval"}@${process.env.POSTGRES_HOST ?? "localhost"}:${process
    .env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "naval"}`;

export const pool = new Pool({
  connectionString
});

export async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      post_title TEXT NOT NULL,
      url TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536) NOT NULL
    );
  `);

  // Backfill / migrate older schemas if this table already existed.
  await pool.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS post_title TEXT;`);
  await pool.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS url TEXT;`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_post_id ON chunks(post_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_url ON chunks(url);
  `);

  // Full-text search for recall on keyword-y queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_content_fts
    ON chunks USING GIN (to_tsvector('english', content));
  `);

  // Optional: trigram index helps short/partial matches in some cases
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm
    ON chunks USING GIN (content gin_trgm_ops);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
  `);
}

