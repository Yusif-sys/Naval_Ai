## Naval Archive Chat

Fan-made RAG chat assistant over [`nav.al/archive`](https://nav.al/archive).  
**Disclaimer:** *Fan-made assistant referencing Naval’s public writing; not Naval.*

### Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS
- **Backend**: Next.js API route, OpenAI for embeddings + chat
- **Database**: Postgres + `pgvector` (via `pgvector/pgvector:pg16` image)
- **Ingest**: TypeScript scripts (`npm run ingest`) to crawl, chunk, embed, and load into Postgres

### Setup

1. **Install dependencies**

```bash
cd /Users/elmarimanov/Naval
npm install
```

### Node version (important)

You must use **Node 20+** (recommended: **Node 22**) for `openai` + `undici` compatibility.

If you use `nvm`:

```bash
nvm use 22
node -v
```

2. **Environment variables**

Copy the example file and fill in values:

```bash
cp .env.example .env.local
```

Required:

- **`OPENAI_API_KEY`**: your OpenAI API key
- Optionally override:
  - **`OPENAI_MODEL`** (default: `gpt-4o-mini`)
  - **`EMBEDDING_MODEL`** (default: `text-embedding-3-small`)
- Database (either `DATABASE_URL` or the `POSTGRES_*` vars).

3. **Run Postgres + pgvector**

```bash
docker compose up -d
```

This starts Postgres with the `pgvector` extension available.

4. **Run migrations**

```bash
npm run migrate
```

This ensures:

- `posts` table (full article content)
- `chunks` table (chunked text + `vector(1536)` embeddings)
- necessary indexes, including `ivfflat` on embeddings

5. **Ingest Naval’s archive**

```bash
npm run ingest
```

For a quick smoke test (ingest just a few posts):

```bash
INGEST_LIMIT=5 npm run ingest
```

What this does:

- Fetches `https://nav.al/archive`
- Parses and de-duplicates post links into an in-memory manifest
- For each post (polite crawling, ~1 req/sec with retries):
  - Downloads the page HTML
  - Extracts main article text (nav/footer/scripts stripped)
  - Stores it in `posts`
  - Chunks the content (~600 tokens, 100-token overlap)
  - Embeds each chunk with OpenAI
  - Stores chunks + embeddings in `chunks` with metadata:
    - `post_id`, `chunk_index`, `content`, `embedding`

### Running the app

Start the Next.js dev server:

```bash
npm run dev
```

Then open `http://localhost:3000` in your browser.

### How chat works

- **Route**: `POST /api/chat` with JSON body `{ "message": string }`
- **Flow**:
  1. Embed the question using the same embedding model used at ingest
  2. Query `chunks` using `ORDER BY embedding <=> $1 LIMIT 8`
  3. Build a context string with the top chunks (including title + URL)
  4. Call OpenAI Chat (`OPENAI_MODEL`) with:
     - System prompt that forces answers **only** from provided context
     - User message containing context + question
  5. Return JSON:
     - `answer`: model’s response
     - `citations`: unique `{ title, url }` pairs from retrieved chunks

### Frontend UX

- **Chat pane**:
  - User and assistant messages in a clean, modern, dark UI
  - Assistant messages show inline **Sources** list for each answer
- **Sources sidebar**:
  - Persistent session-level list of all sources cited so far
  - Clickable links out to the original `nav.al` posts
- **Disclaimer banner** (top of page):
  - Text: **“Fan-made assistant referencing Naval’s public writing; not Naval.”**
  - Explicit callout that answers are generated from `nav.al/archive`

### Useful scripts

- **`npm run dev`** – start Next.js dev server
- **`npm run build`** – production build
- **`npm run start`** – run built app
- **`npm run lint`** – run Next.js/ESLint
- **`npm run migrate`** – ensure Postgres schema and pgvector indexes
- **`npm run ingest`** – crawl + ingest Naval archive into Postgres

