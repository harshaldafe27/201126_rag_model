import { GoogleGenAI } from '@google/genai';
import { createLogger } from './logger.ts';

const EMBEDDING_MODEL = 'gemini-embedding-2';
const CONCURRENCY_LIMIT = 5;
const logger = createLogger('Embeddings');

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeVector(values: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < values.length; i++) {
    normSq += values[i] * values[i];
  }
  const norm = Math.sqrt(normSq);
  if (!norm || !Number.isFinite(norm)) return values;
  return values.map((v) => v / norm);
}

async function embedSingleWithRetry(text: string, attempt = 1): Promise<number[]> {
  const ai = getGeminiClient();
  try {
    const result = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    const values = result.embeddings?.[0]?.values ?? [];
    if (values.length === 0) {
      throw new Error('Embedding service returned an empty vector.');
    }
    return normalizeVector(values);
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    const retryable =
      msg.includes('429') ||
      msg.includes('temporarily') ||
      msg.includes('timeout') ||
      msg.includes('503') ||
      msg.includes('unavailable') ||
      msg.includes('overloaded') ||
      msg.includes('high demand');
    if (retryable && attempt < 3) {
      const waitMs = attempt * 750;
      logger.info('Retrying embedding after transient upstream error', { attempt, waitMs });
      await new Promise((r) => setTimeout(r, waitMs));
      return embedSingleWithRetry(text, attempt + 1);
    }
    throw err;
  }
}

export async function embedDocumentTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // gemini-embedding-2 treats an array of strings as one multimodal item,
  // so embed each chunk independently with bounded concurrency.
  const results: number[][] = new Array(texts.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      const truncated = texts[index].slice(0, 7500);
      results[index] = await embedSingleWithRetry(truncated);
    }
  };

  const workerCount = Math.min(CONCURRENCY_LIMIT, texts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  logger.info('Generated chunk embeddings', {
    count: results.length,
    dimensions: results[0]?.length ?? 0,
    model: EMBEDDING_MODEL,
  });
  return results;
}

export async function embedQueryText(query: string): Promise<number[]> {
  const cleaned = query.trim().slice(0, 4000);
  if (!cleaned) {
    throw new Error('Cannot generate an embedding for an empty question.');
  }
  return embedSingleWithRetry(cleaned);
}
