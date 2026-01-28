import { encoding_for_model } from "@dqbd/tiktoken";

const MODEL_FOR_ENCODING = "gpt-4o-mini";

export function chunkText(
  text: string,
  opts: { chunkTokens?: number; overlapTokens?: number } = {}
): string[] {
  const chunkTokens = opts.chunkTokens ?? 600;
  const overlapTokens = opts.overlapTokens ?? 100;

  const enc = encoding_for_model(MODEL_FOR_ENCODING);
  const decoder = new TextDecoder();
  const tokens = enc.encode(text);

  const chunks: string[] = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(start + chunkTokens, tokens.length);
    const chunkTokensSlice = tokens.slice(start, end);
    // @dqbd/tiktoken returns Uint8Array from decode()
    const decodedBytes = enc.decode(chunkTokensSlice);
    const chunkText = decoder.decode(decodedBytes);
    chunks.push(chunkText.trim());
    if (end === tokens.length) {
      break;
    }
    start = end - overlapTokens;
    if (start < 0) start = 0;
  }

  enc.free();
  return chunks.filter(c => c.length > 0);
}

