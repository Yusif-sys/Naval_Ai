import dotenv from "dotenv";
import { resolve } from "path";
import { pool } from "../lib/db";
import { embedText } from "../lib/embedding";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config();

async function testEmbedding() {
  const client = await pool.connect();
  try {
    // Test embedding
    const testText = "This is a test chunk for Naval's archive.";
    console.log("Testing embedding generation...");
    const [embedding] = await embedText([testText]);
    
    console.log(`Embedding length: ${embedding.length}`);
    console.log(`First 5 values: ${embedding.slice(0, 5).join(", ")}`);
    
    // Test insert
    console.log("\nTesting database insert...");
    const embeddingStr = `[${embedding.join(",")}]`;
    console.log(`Embedding string length: ${embeddingStr.length}`);
    console.log(`First 50 chars: ${embeddingStr.substring(0, 50)}...`);
    
    await client.query("BEGIN");
    
    // Insert test post
    const postRes = await client.query(
      `INSERT INTO posts (url, title, year, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      ["https://test.example.com", "Test Post", 2024, testText]
    );
    const postId = postRes.rows[0].id;
    console.log(`Inserted test post with id: ${postId}`);
    
    // Insert test chunk
    await client.query(
      `INSERT INTO chunks (post_id, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [postId, 0, testText, embeddingStr]
    );
    console.log("✓ Successfully inserted chunk with embedding!");
    
    await client.query("COMMIT");
    
    // Verify
    const verify = await client.query(
      "SELECT id, chunk_index, length(content) as content_len FROM chunks WHERE post_id = $1",
      [postId]
    );
    console.log("\nVerification:", verify.rows);
    
    // Cleanup
    await client.query("DELETE FROM chunks WHERE post_id = $1", [postId]);
    await client.query("DELETE FROM posts WHERE id = $1", [postId]);
    console.log("✓ Test complete, cleaned up.");
    
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("✗ Test failed:", err?.message || err);
    if (err?.stack) {
      console.error("Stack:", err.stack);
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

void testEmbedding().catch(err => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
