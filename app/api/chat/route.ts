import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { pool } from "../../../lib/db";
import { embedText } from "../../../lib/embedding";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export const runtime = "nodejs";

type RetrievedChunk = {
  chunk_content: string;
  post_title: string;
  post_url: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message: string | undefined = body?.message;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing 'message' in request body." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const [questionEmbedding] = await embedText([message]);

    let client;
    try {
      client = await pool.connect();
    } catch (dbErr: any) {
      const msg = String(dbErr?.message ?? "");
      const isLocalRefused =
        msg.includes("ECONNREFUSED") &&
        (msg.includes("127.0.0.1:5432") || msg.includes("localhost:5432"));

      return NextResponse.json(
        {
          error: isLocalRefused
            ? "Database connection refused. On Vercel, localhost:5432 is not your Postgres. Set DATABASE_URL to a hosted Postgres (Neon/Supabase/Railway/Vercel Postgres) and run `npm run migrate` + `npm run ingest` against it."
            : "Database connection failed. Verify DATABASE_URL on the server points to a reachable Postgres with pgvector enabled."
        },
        { status: 500 }
      );
    }
    try {
      // Format embedding for pgvector query: '[0.1,0.2,...]'
      const embeddingStr = `[${questionEmbedding.join(",")}]`;
      // Candidate pool sizes (final answer still uses only topK=8 chunks).
      // Higher values improve recall at the cost of a slightly slower query.
      const vectorK = Number(process.env.RETRIEVAL_VECTOR_K ?? "80");
      const ftsK = Number(process.env.RETRIEVAL_FTS_K ?? "80");
      const trgmK = Number(process.env.RETRIEVAL_TRGM_K ?? "60");
      const topK = 8;

      // 1) Vector candidates
      const vectorRes = await client.query(
        `
        SELECT
          c.content AS chunk_content,
          c.post_title AS post_title,
          c.url AS post_url
        FROM chunks c
        ORDER BY c.embedding <=> $1::vector
        LIMIT $2;
        `,
        [embeddingStr, vectorK]
      );

      // 2) Full-text candidates (keyword recall)
      const ftsRes = await client.query(
        `
        SELECT
          c.content AS chunk_content,
          c.post_title AS post_title,
          c.url AS post_url
        FROM chunks c
        WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', $1)) DESC
        LIMIT $2;
        `,
        [message, ftsK]
      );

      // 3) Trigram candidates (helps short queries / proper nouns / partial phrases)
      const trgmRes = await client.query(
        `
        SELECT
          c.content AS chunk_content,
          c.post_title AS post_title,
          c.url AS post_url
        FROM chunks c
        ORDER BY GREATEST(
          similarity(c.post_title, $1),
          similarity(c.url, $1),
          similarity(c.content, $1)
        ) DESC
        LIMIT $2;
        `,
        [message, trgmK]
      );

      // Reciprocal Rank Fusion (simple, robust)
      const score = new Map<string, { chunk: RetrievedChunk; score: number }>();

      function addWithRank(rows: RetrievedChunk[], weight: number) {
        rows.forEach((r, idx) => {
          // Deterministic-ish key; collisions are fine (we just dedupe aggressively)
          const key = `${r.post_url}::${r.post_title}::${r.chunk_content.slice(0, 120)}`;
          const existing = score.get(key);
          const rrf = weight * (1 / (60 + (idx + 1)));
          if (!existing) score.set(key, { chunk: r, score: rrf });
          else score.set(key, { chunk: existing.chunk, score: existing.score + rrf });
        });
      }

      addWithRank(vectorRes.rows as RetrievedChunk[], 1.0);
      addWithRank(ftsRes.rows as RetrievedChunk[], 1.0);
      addWithRank(trgmRes.rows as RetrievedChunk[], 0.8);

      const rows = Array.from(score.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(x => x.chunk);

      let answer: string;
      if (!rows.length) {
        // Fallback: no usable context at all. Still answer something helpful,
        // but clearly as a fan-made assistant (not Naval, and not citing archive).
        const fallbackPrompt =
          "You are a fan-made assistant loosely inspired by Naval Ravikant's ideas.\n" +
          "- Answer the user's question in a concise, thoughtful way in first person.\n" +
          "- DO NOT claim to actually be Naval.\n" +
          "- DO NOT mention archives, retrieval, or that you couldn't find anything.\n" +
          "- It's okay to generalize from typical Naval-like themes (leverage, specific knowledge, accountability, etc.).";

        const completion = await openai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: fallbackPrompt },
            { role: "user", content: message }
          ],
          temperature: 0.7
        });

        answer =
          completion.choices[0]?.message?.content ??
          "Here’s a high-level perspective, inspired by Naval’s style, on that question.";

        return NextResponse.json({ answer, citations: [] });
      }

      const contextBlocks = rows.map(
        (r, idx) =>
          `Chunk ${idx + 1} (from "${r.post_title}" - ${r.post_url}):\n${r.chunk_content}`
      );
      const context = contextBlocks.join("\n\n---\n\n");

      const systemPrompt =
        "You are a fan-made assistant that answers questions using ONLY the provided context, " +
        "which consists of passages from Naval Ravikant's public writing at nav.al/archive.\n" +
        "- Write in first person (as if speaking in Naval's voice), but DO NOT claim to actually be Naval.\n" +
        "- Do not invent personal experiences or details not present in the context.\n" +
        "- Be helpful and 'lenient': if the context is only partially relevant, give the best answer you can FROM the context.\n" +
        "- If the question cannot be answered directly, say so briefly, then share the closest relevant ideas from the context.\n" +
        "- NEVER say the phrase: \"I don't know based on this archive\".\n" +
        "- Do NOT say that you couldn't find relevant passages.\n" +
        "- Do not use external knowledge.\n" +
        "- If a short follow-up question would help, ask ONE follow-up question at the end.";

      const chatCompletion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              `Context from Naval's archive:\n\n${context}\n\n` +
              `Question: ${message}\n\n` +
              "Answer using only the context above. If it's only partially relevant, answer with what it supports."
          }
        ],
        temperature: 0.3
      });

      answer =
        chatCompletion.choices[0]?.message?.content ??
        "I’m unable to answer this question from the provided context.";

      const citationMap = new Map<string, { title: string; url: string }>();
      for (const row of rows) {
        const key = row.post_url as string;
        if (!citationMap.has(key)) {
          citationMap.set(key, {
            title: row.post_title as string,
            url: row.post_url as string
          });
        }
      }

      const citations = Array.from(citationMap.values());

      return NextResponse.json({ answer, citations });
    } finally {
      // Return connection to the pool
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await client?.release();
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("Chat API error", err);
    
    // Provide more helpful error messages
    if (err?.status === 429) {
      return NextResponse.json(
        { error: "OpenAI rate limit exceeded. Please try again in a moment." },
        { status: 429 }
      );
    }
    if (err?.code === "insufficient_quota" || err?.status === 429) {
      return NextResponse.json(
        { error: "OpenAI quota exceeded. Please check your billing and usage limits." },
        { status: 402 }
      );
    }
    if (err?.message?.includes("OPENAI_API_KEY")) {
      return NextResponse.json(
        { error: "OpenAI API key is missing or invalid." },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: err?.status || 500 }
    );
  }
}

