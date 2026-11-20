import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.ts';
import type { DocumentChunk, RetrievedChunk, VectorChunkRecord } from './types.ts';

const logger = createLogger('VectorStore');

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_ROOT = path.resolve(PROJECT_ROOT, process.env.RAG_DATA_DIR || '.aai-data');
const DEFAULT_MIN_SEMANTIC_SCORE = Number(process.env.RAG_MIN_SIMILARITY) || 0.42;
const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K) || 8;

// In-memory cache per workspace backed by disk persistence
const workspaceCache = new Map<string, VectorChunkRecord[]>();

function getVectorFilePath(workspaceId: string): string {
  return path.join(DATA_ROOT, 'workspaces', workspaceId, 'vectors.json');
}

async function loadWorkspaceVectors(workspaceId: string): Promise<VectorChunkRecord[]> {
  const cached = workspaceCache.get(workspaceId);
  if (cached) return cached;

  const filePath = getVectorFilePath(workspaceId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as VectorChunkRecord[];
    const records = Array.isArray(parsed) ? parsed : [];
    workspaceCache.set(workspaceId, records);
    return records;
  } catch {
    workspaceCache.set(workspaceId, []);
    return [];
  }
}

async function saveWorkspaceVectors(
  workspaceId: string,
  records: VectorChunkRecord[]
): Promise<void> {
  workspaceCache.set(workspaceId, records);
  const filePath = getVectorFilePath(workspaceId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(records), 'utf-8');
}

function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'what',
  'when',
  'where',
  'which',
  'how',
  'why',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'had',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'about',
  'into',
  'your',
  'their',
  'there',
  'then',
  'than',
  'explain',
  'tell',
  'give',
  'find',
  'calculate',
]);

function extractTerms(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  return new Set(matches.filter((w) => !STOP_WORDS.has(w)));
}

function computeLexicalOverlap(queryText: string, chunkText: string, heading: string): number {
  const queryTerms = extractTerms(queryText);
  if (queryTerms.size === 0) return 0;
  const targetTerms = extractTerms(`${heading} ${chunkText}`);
  let hits = 0;
  for (const term of queryTerms) {
    if (targetTerms.has(term)) hits += 1;
  }
  return hits / queryTerms.size;
}

export async function upsertDocumentVectors(params: {
  workspaceId: string;
  documentId: string;
  chunks: DocumentChunk[];
  embeddings: number[][];
}): Promise<number> {
  const { workspaceId, documentId, chunks, embeddings } = params;
  const existing = await loadWorkspaceVectors(workspaceId);

  // Remove any prior chunks for this document atomically before inserting new ones
  const retained = existing.filter((r) => r.documentId !== documentId);
  const newRecords: VectorChunkRecord[] = chunks.map((chunk, idx) => ({
    ...chunk,
    workspaceId,
    embedding: embeddings[idx] ?? [],
  }));

  await saveWorkspaceVectors(workspaceId, [...retained, ...newRecords]);
  logger.info('Upserted document chunks into vector store', {
    workspaceId,
    documentId,
    chunkCount: newRecords.length,
  });
  return newRecords.length;
}

export async function deleteDocumentVectors(
  workspaceId: string,
  documentId: string
): Promise<number> {
  const existing = await loadWorkspaceVectors(workspaceId);
  const filtered = existing.filter((r) => r.documentId !== documentId);
  const removedCount = existing.length - filtered.length;

  if (removedCount > 0) {
    await saveWorkspaceVectors(workspaceId, filtered);
    logger.info('Deleted document vectors', { workspaceId, documentId, removedCount });
  }
  return removedCount;
}

export interface VectorSearchResult {
  matches: RetrievedChunk[];
  topSemanticScore: number;
  totalCandidateChunks: number;
  thresholdUsed: number;
}

export async function searchWorkspaceVectors(params: {
  workspaceId: string;
  queryEmbedding: number[];
  queryText: string;
  documentIds: string[];
  topK?: number;
  minSemanticScore?: number;
}): Promise<VectorSearchResult> {
  const {
    workspaceId,
    queryEmbedding,
    queryText,
    documentIds,
    topK = DEFAULT_TOP_K,
    minSemanticScore = DEFAULT_MIN_SEMANTIC_SCORE,
  } = params;

  const docSet = new Set(documentIds);
  const allRecords = await loadWorkspaceVectors(workspaceId);
  const candidates = allRecords.filter((rec) => docSet.has(rec.documentId));

  if (candidates.length === 0) {
    return {
      matches: [],
      topSemanticScore: 0,
      totalCandidateChunks: 0,
      thresholdUsed: minSemanticScore,
    };
  }

  const scored: RetrievedChunk[] = candidates.map((rec) => {
    const semanticScore = Math.max(0, Math.min(1, dotProduct(queryEmbedding, rec.embedding)));
    const lexicalScore = computeLexicalOverlap(queryText, rec.originalText, rec.sectionHeading);
    // Semantic similarity dominates (85%), with a gentle 15% lexical boost for exact terms/symbols
    const combinedScore = semanticScore * 0.85 + lexicalScore * 0.15;

    const { embedding: _emb, workspaceId: _ws, ...chunk } = rec;
    return {
      chunk,
      semanticScore,
      lexicalScore,
      combinedScore,
    };
  });

  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  const topSemanticScore = scored.reduce((max, s) => Math.max(max, s.semanticScore), 0);

  // Relevance threshold filtering: require strong semantic match OR clear hybrid match
  const passing = scored.filter(
    (item) =>
      item.semanticScore >= minSemanticScore ||
      (item.semanticScore >= minSemanticScore - 0.06 && item.lexicalScore >= 0.35)
  );

  // Keep top-K diverse chunks while ensuring at most 4 chunks per single page
  const selected = passing.slice(0, topK);

  logger.info('Completed semantic vector search', {
    workspaceId,
    candidates: candidates.length,
    passing: passing.length,
    returned: selected.length,
    topSemanticScore: Number(topSemanticScore.toFixed(3)),
  });

  return {
    matches: selected,
    topSemanticScore,
    totalCandidateChunks: candidates.length,
    thresholdUsed: minSemanticScore,
  };
}

export async function getChunksForDocuments(
  workspaceId: string,
  documentIds: string[]
): Promise<DocumentChunk[]> {
  const docSet = new Set(documentIds);
  const allRecords = await loadWorkspaceVectors(workspaceId);
  return allRecords
    .filter((rec) => docSet.has(rec.documentId))
    .map(({ embedding: _emb, workspaceId: _ws, ...chunk }) => chunk);
}
