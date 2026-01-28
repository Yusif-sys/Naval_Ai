import dotenv from "dotenv";
import { resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import * as cheerio from "cheerio";
import { ensureSchema, pool } from "../lib/db";
import { chunkText } from "../lib/chunk";
import { embedText } from "../lib/embedding";
import { fetchText } from "../lib/http";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config(); // fallback to .env

const ARCHIVE_URL = "https://nav.al/archive";
const RATE_LIMIT_MS = 1000;
const MAX_RETRIES = 3;

type ManifestEntry = {
  title: string;
  url: string;
  year: number | null;
};

function normalizeUrl(url: string) {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  // Normalize trailing slash (keep root as https://nav.al/)
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

function isLikelyPostUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname !== "nav.al") return false;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    // Exclude non-post pages / sections
    const blocked = new Set([
      "/",
      "/archive",
      "/podcast",
      "/quotes",
      "/interviews",
      "/search",
      "/startups",
      "/wealth",
      "/happiness-2",
      "/jobs",
      "/science",
      "/politics",
      "/technology",
      "/stories",
      "/sundry",
      "/crypto",
      "/uncategorized",
      "/venture-capital"
    ]);
    if (blocked.has(path)) return false;
    // Posts are typically a single slug like /specific-knowledge
    if (!path.startsWith("/")) return false;
    const parts = path.split("/").filter(Boolean);
    if (parts.length !== 1) return false;
    // Avoid obvious non-post resources
    if (parts[0].includes(".")) return false;
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetries(url: string, attempt = 1): Promise<string> {
  try {
    return await fetchText(url);
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      throw err;
    }
    await sleep(500 * attempt);
    return fetchWithRetries(url, attempt + 1);
  }
}

function inferYearFromText(text: string): number | null {
  const match = text.match(/\b(20[0-4][0-9]|19[8-9][0-9])\b/);
  return match ? Number(match[1]) : null;
}

async function buildManifest(): Promise<ManifestEntry[]> {
  // eslint-disable-next-line no-console
  console.log("Fetching archive index...");
  const html = await fetchWithRetries(ARCHIVE_URL);
  const $ = cheerio.load(html);

  const links = new Map<string, ManifestEntry>();

  $("a").each((_, el) => {
    let href = $(el).attr("href") ?? "";
    const title = $(el).text().trim();
    if (!href || !title) return;
    if (href.startsWith("#")) return;
    if (!href.startsWith("http")) {
      if (href.startsWith("/")) {
        href = `https://nav.al${href}`;
      } else {
        href = `https://nav.al/${href}`;
      }
    }
    const url = normalizeUrl(href);
    if (!isLikelyPostUrl(url)) return;

    const year = inferYearFromText($(el).parent().text());
    if (!links.has(url)) {
      links.set(url, { title, url, year });
    }
  });

  const manifest = Array.from(links.values()).sort((a, b) => a.url.localeCompare(b.url));

  // Save manifest to disk
  const outDir = resolve(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  return manifest;
}

function extractMainContent(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, nav, header, footer, form, noscript").remove();

  const articleSelectors = ["article", ".post", ".entry-content", ".content", ".post-content"];
  let text = "";
  for (const sel of articleSelectors) {
    const el = $(sel);
    if (el.length) {
      text = el
        .text()
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 200) break;
    }
  }

  if (!text || text.length < 200) {
    text = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();
  }

  return text;
}

async function ingest() {
  await ensureSchema();

  const client = await pool.connect();
  try {
    let manifest = await buildManifest();
    // eslint-disable-next-line no-console
    console.log(`Discovered ${manifest.length} candidate posts.`);

    const ingestLimitRaw = process.env.INGEST_LIMIT;
    const ingestLimit =
      ingestLimitRaw && ingestLimitRaw.trim().length > 0 ? Number(ingestLimitRaw) : null;
    if (ingestLimit && Number.isFinite(ingestLimit) && ingestLimit > 0) {
      manifest = manifest.slice(0, ingestLimit);
      // eslint-disable-next-line no-console
      console.log(`INGEST_LIMIT=${ingestLimit} → ingesting first ${manifest.length} posts only.`);
    }

    for (let i = 0; i < manifest.length; i++) {
      const entry = manifest[i];
      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${manifest.length}] Ingesting ${entry.title} - ${entry.url}`);

      await sleep(RATE_LIMIT_MS);

      const existing = await client.query("SELECT id FROM posts WHERE url = $1", [entry.url]);
      if (existing.rowCount && existing.rows.length > 0) {
        // eslint-disable-next-line no-console
        console.log("Already ingested, skipping.");
        continue;
      }

      try {
        const html = await fetchWithRetries(entry.url);
        const content = extractMainContent(html);
        if (!content || content.length < 200) {
          // eslint-disable-next-line no-console
          console.warn(`  Content too short (${content.length} chars), skipping.`);
          continue;
        }

        await client.query("BEGIN");
        
        const postRes = await client.query(
          `INSERT INTO posts (url, title, year, content)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [entry.url, entry.title, entry.year, content]
        );
        const postId = postRes.rows[0].id as number;
        // eslint-disable-next-line no-console
        console.log(`  Inserted post with id ${postId}`);

        const chunks = chunkText(content, { chunkTokens: 600, overlapTokens: 100 });
        // eslint-disable-next-line no-console
        console.log(`  Chunked into ${chunks.length} chunks.`);

        if (chunks.length === 0) {
          await client.query("ROLLBACK");
          // eslint-disable-next-line no-console
          console.warn("  No chunks generated, rolling back.");
          continue;
        }

        const embeddings = await embedText(chunks);
        // eslint-disable-next-line no-console
        console.log(`  Generated ${embeddings.length} embeddings.`);

        if (embeddings.length !== chunks.length) {
          await client.query("ROLLBACK");
          // eslint-disable-next-line no-console
          console.error(`  Embedding count mismatch: ${embeddings.length} != ${chunks.length}, rolling back.`);
          continue;
        }

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          const embedding = embeddings[idx];
          
          if (!Array.isArray(embedding) || embedding.length !== 1536) {
            throw new Error(`Invalid embedding at index ${idx}: length=${embedding?.length}`);
          }
          
          // Format embedding for pgvector: '[0.1,0.2,...]' (no quotes around numbers)
          const embeddingStr = `[${embedding.join(",")}]`;
          
          await client.query(
            `INSERT INTO chunks (post_id, chunk_index, post_title, url, content, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [postId, idx, entry.title, entry.url, chunk, embeddingStr]
          );
        }

        await client.query("COMMIT");
        // eslint-disable-next-line no-console
        console.log(`  ✓ Successfully ingested ${chunks.length} chunks.`);
      } catch (err: any) {
        await client.query("ROLLBACK").catch(() => {
          // Ignore rollback errors
        });
        // eslint-disable-next-line no-console
        console.error(`  ✗ Failed to ingest ${entry.url}:`, err?.message || err);
        if (err?.stack) {
          // eslint-disable-next-line no-console
          console.error("  Stack:", err.stack.split("\n").slice(0, 3).join("\n"));
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void ingest().catch(err => {
  // eslint-disable-next-line no-console
  console.error("Fatal ingest error", err);
  process.exitCode = 1;
});

