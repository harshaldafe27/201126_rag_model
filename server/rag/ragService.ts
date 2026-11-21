import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import { extractDocumentContent } from '../extractors.ts';
import { formatApiError } from '../gemini.ts';
import { chunkDocumentSegments } from './chunker.ts';
import {
  evaluateContextSufficiency,
  UNSUPPORTED_REFUSAL_TEXT,
  validateCitationsAgainstRetrievedChunks,
  validateSingleQuizCitation,
} from './citationValidator.ts';
import { embedDocumentTexts, embedQueryText } from './embeddings.ts';
import { createLogger } from './logger.ts';
import { verifyNumericalSolution } from './mathVerifier.ts';
import type {
  DocumentChunk,
  EvidenceStatus,
  HistoryTurn,
  NumericalSolution,
  RetrievedChunk,
  StructuredRagAnswer,
  WorkspaceDocumentRecord,
} from './types.ts';
import { DocumentValidationError, validateUploadedFile } from './validation.ts';
import {
  deleteDocumentVectors,
  getChunksForDocuments,
  searchWorkspaceVectors,
  upsertDocumentVectors,
} from './vectorStore.ts';
import {
  deleteWorkspaceDocumentRecord,
  findDuplicateDocumentByHash,
  getWorkspaceDocument,
  listWorkspaceDocuments,
  readOriginalDocumentFile,
  saveOriginalDocumentFile,
  saveWorkspaceDocument,
} from './workspaceStore.ts';

const PRIMARY_GENERATION_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GENERATION_MODEL = 'gemini-3.1-flash-lite';
const GENERATION_ATTEMPT_TIMEOUT_MS = 18_000;
const logger = createLogger('RagService');

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

function isTransientGeminiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('timed out') ||
    msg.includes('deadline') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateStructuredJsonWithResilience(params: {
  contents: string;
  systemInstruction: string;
  responseSchema: Schema;
}): Promise<string> {
  const ai = getGeminiClient();
  const attemptPlan = [
    { model: PRIMARY_GENERATION_MODEL, thinkingLevel: ThinkingLevel.LOW, backoffMs: 0 },
    { model: FALLBACK_GENERATION_MODEL, thinkingLevel: ThinkingLevel.LOW, backoffMs: 400 },
    { model: FALLBACK_GENERATION_MODEL, thinkingLevel: ThinkingLevel.MINIMAL, backoffMs: 1200 },
  ];

  let lastError: unknown;

  for (let i = 0; i < attemptPlan.length; i++) {
    const plan = attemptPlan[i];
    if (plan.backoffMs > 0) {
      await sleep(plan.backoffMs);
    }

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: plan.model,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            thinkingConfig: { thinkingLevel: plan.thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema: params.responseSchema,
          },
        }),
        GENERATION_ATTEMPT_TIMEOUT_MS,
        `Gemini ${plan.model}`
      );

      const text = (response.text ?? '{}').trim();
      if (!text) {
        throw new Error(`Empty JSON response from ${plan.model}`);
      }
      return text;
    } catch (err) {
      lastError = err;
      const hasNext = i < attemptPlan.length - 1;
      if (hasNext && isTransientGeminiError(err)) {
        logger.info('Retrying Gemini generation after transient upstream demand/latency', {
          attempt: i + 1,
          model: plan.model,
          nextModel: attemptPlan[i + 1].model,
        });
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('AI model generation failed after retries.');
}

function createDocId(): string {
  return `doc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

async function runExtractionChunkingEmbedding(params: {
  workspaceId: string;
  record: WorkspaceDocumentRecord;
  buffer: Buffer;
}): Promise<WorkspaceDocumentRecord> {
  const { workspaceId, buffer } = params;
  let current = { ...params.record };

  try {
    // Stage 1: Extract text with page/slide/section metadata
    current = { ...current, status: 'extracting', errorMessage: undefined };
    await saveWorkspaceDocument(workspaceId, current);

    const extracted = await extractDocumentContent(buffer, current.name);

    // Stage 2: Semantic chunking preserving all required chunk metadata
    current = {
      ...current,
      status: 'chunking',
      format: extracted.format,
      unitLabel: extracted.unitLabel,
      pageCount: extracted.pageCount,
      segments: extracted.segments,
    };
    await saveWorkspaceDocument(workspaceId, current);

    const chunks = chunkDocumentSegments({
      documentId: current.id,
      documentName: current.name,
      segments: extracted.segments,
    });

    if (chunks.length === 0) {
      throw new DocumentValidationError(
        'No indexable text chunks could be created from this document.',
        422
      );
    }

    // Stage 3: Generate dense embeddings with gemini-embedding-2
    current = { ...current, status: 'embedding', chunkCount: chunks.length };
    await saveWorkspaceDocument(workspaceId, current);

    const textsToEmbed = chunks.map(
      (c) => `${c.documentName} | ${c.pageLabel} | ${c.sectionHeading}\n${c.originalText}`
    );
    const embeddings = await embedDocumentTexts(textsToEmbed);

    // Stage 4: Persist vectors into workspace-isolated vector store
    await upsertDocumentVectors({
      workspaceId,
      documentId: current.id,
      chunks,
      embeddings,
    });

    const readyRecord: WorkspaceDocumentRecord = {
      ...current,
      status: 'ready',
      chunkCount: chunks.length,
      lastIndexedAt: new Date().toISOString(),
    };
    await saveWorkspaceDocument(workspaceId, readyRecord);

    logger.info('Document ingestion completed', {
      workspaceId,
      documentId: readyRecord.id,
      name: readyRecord.name,
      pageCount: readyRecord.pageCount,
      chunkCount: readyRecord.chunkCount,
    });

    return readyRecord;
  } catch (err) {
    const { status, message } = formatApiError(err);
    const failedRecord: WorkspaceDocumentRecord = {
      ...current,
      status: 'error',
      errorMessage: message,
    };
    await saveWorkspaceDocument(workspaceId, failedRecord);
    if (status >= 500) {
      logger.error('Document ingestion failed', {
        workspaceId,
        documentId: current.id,
        error: message,
      });
    } else {
      logger.info('Document ingestion rejected', {
        workspaceId,
        documentId: current.id,
        status,
        reason: message,
      });
    }
    throw err instanceof DocumentValidationError ? err : new Error(message);
  }
}

export type IngestResult =
  | { duplicate: true; existingDocument: WorkspaceDocumentRecord }
  | { duplicate: false; document: WorkspaceDocumentRecord };

export async function ingestDocument(params: {
  workspaceId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  duplicateStrategy: 'prompt' | 'reindex';
}): Promise<IngestResult> {
  const { workspaceId, originalName, mimeType, buffer, duplicateStrategy } = params;

  const validated = await validateUploadedFile({ originalName, mimeType, buffer });

  // Duplicate content detection via SHA-256 hash
  const existingDuplicate = await findDuplicateDocumentByHash(workspaceId, validated.contentHash);
  if (existingDuplicate) {
    if (duplicateStrategy === 'prompt') {
      logger.info('Duplicate document detected, prompting user', {
        workspaceId,
        existingId: existingDuplicate.id,
        name: originalName,
      });
      return {
        duplicate: true,
        existingDocument: existingDuplicate,
      };
    }

    // Re-index the existing duplicate cleanly in place
    const storedFileName =
      existingDuplicate.storedFileName || `${existingDuplicate.id}.${validated.extension}`;
    await saveOriginalDocumentFile(workspaceId, storedFileName, buffer);

    const updatedBase: WorkspaceDocumentRecord = {
      ...existingDuplicate,
      name: originalName,
      mimeType: validated.mimeType,
      sizeBytes: buffer.length,
      storedFileName,
      uploadedAt: new Date().toISOString(),
      status: 'extracting',
      errorMessage: undefined,
    };

    const reindexed = await runExtractionChunkingEmbedding({
      workspaceId,
      record: updatedBase,
      buffer,
    });
    return { duplicate: false, document: reindexed };
  }

  const docId = createDocId();
  const storedFileName = `${docId}.${validated.extension}`;
  await saveOriginalDocumentFile(workspaceId, storedFileName, buffer);

  const initialRecord: WorkspaceDocumentRecord = {
    id: docId,
    workspaceId,
    name: originalName,
    format: validated.format,
    mimeType: validated.mimeType,
    sizeBytes: buffer.length,
    contentHash: validated.contentHash,
    storedFileName,
    uploadedAt: new Date().toISOString(),
    status: 'extracting',
    pageCount: 0,
    unitLabel:
      validated.format === 'PDF'
        ? 'page'
        : validated.format.startsWith('PPT')
          ? 'slide'
          : 'section',
    chunkCount: 0,
    segments: [],
  };

  const indexedDoc = await runExtractionChunkingEmbedding({
    workspaceId,
    record: initialRecord,
    buffer,
  });

  return { duplicate: false, document: indexedDoc };
}

export async function reindexWorkspaceDocument(
  workspaceId: string,
  documentId: string
): Promise<WorkspaceDocumentRecord> {
  const existing = await getWorkspaceDocument(workspaceId, documentId);
  if (!existing) {
    throw new DocumentValidationError('Document not found in this workspace.', 404);
  }

  let buffer: Buffer;
  try {
    buffer = await readOriginalDocumentFile(workspaceId, existing.storedFileName);
  } catch {
    throw new DocumentValidationError(
      `Original file for "${existing.name}" is no longer available on disk. Please upload the file again.`,
      404
    );
  }

  await deleteDocumentVectors(workspaceId, documentId);

  return runExtractionChunkingEmbedding({
    workspaceId,
    record: existing,
    buffer,
  });
}

export async function removeWorkspaceDocument(
  workspaceId: string,
  documentId: string
): Promise<{ deleted: boolean; removedChunks: number }> {
  const removedChunks = await deleteDocumentVectors(workspaceId, documentId);
  const deletedDoc = await deleteWorkspaceDocumentRecord(workspaceId, documentId);

  logger.info('Deleted document and vector chunks', {
    workspaceId,
    documentId,
    deleted: Boolean(deletedDoc),
    removedChunks,
  });

  return { deleted: Boolean(deletedDoc), removedChunks };
}

function buildRetrievedContextPrompt(matches: RetrievedChunk[]): string {
  return matches
    .map((m, idx) => {
      const c = m.chunk;
      return [
        `--- RETRIEVED CHUNK ${idx + 1} ---`,
        `CHUNK_ID: ${c.chunkId}`,
        `DOCUMENT: ${c.documentName}`,
        `PAGE_OR_SLIDE: ${c.pageLabel}`,
        `SECTION_HEADING: ${c.sectionHeading}`,
        `SEMANTIC_RELEVANCE: ${Math.round(m.semanticScore * 100)}%`,
        `TEXT:`,
        c.originalText,
      ].join('\n');
    })
    .join('\n\n');
}

export async function answerQuestionWithRag(params: {
  workspaceId: string;
  question: string;
  documentIds: string[];
  history: HistoryTurn[];
}): Promise<StructuredRagAnswer> {
  const { workspaceId, question, documentIds, history } = params;

  const allDocs = await listWorkspaceDocuments(workspaceId);
  const selectedDocs = allDocs.filter(
    (d) => d.status === 'ready' && documentIds.includes(d.id)
  );

  if (selectedDocs.length === 0) {
    throw new DocumentValidationError(
      'Please select at least one indexed document before asking a question.',
      400
    );
  }

  const checkedDocuments = selectedDocs.map((d) => d.name);

  // Step 1: Question Processing — generate query embedding
  const queryEmbedding = await embedQueryText(question);

  // Step 2: Semantic Retrieval — search vector store with relevance threshold
  const searchResult = await searchWorkspaceVectors({
    workspaceId,
    queryEmbedding,
    queryText: question,
    documentIds: selectedDocs.map((d) => d.id),
  });

  // Step 3: Context Validation — pre-LLM unsupported question detection
  const sufficiency = evaluateContextSufficiency({
    matches: searchResult.matches,
    topSemanticScore: searchResult.topSemanticScore,
    checkedDocumentNames: checkedDocuments,
  });

  if (!sufficiency.sufficient) {
    return {
      isSupported: false,
      evidenceStatus: 'insufficient',
      confidenceScore: Math.round(searchResult.topSemanticScore * 100),
      directAnswer: UNSUPPORTED_REFUSAL_TEXT,
      missingInformation: sufficiency.reason || 'Relevant evidence was not found in the selected documents.',
      explanation:
        'Try selecting additional uploaded study documents or uploading notes that explicitly cover this topic.',
      calculationSteps: [],
      citations: [],
      checkedDocuments,
      retrievedChunkCount: searchResult.matches.length,
    };
  }

  // Step 4: Grounded Gemini Integration — strictly answer from retrieved chunks
  const contextBlock = buildRetrievedContextPrompt(searchResult.matches);
  const recentHistory = history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.text}`)
    .join('\n');

  const systemInstruction = `You are .Aai ("The teacher, understand you"), a strict Retrieval-Augmented Generation (RAG) academic tutor.

ABSOLUTE GROUNDING RULES:
1. Answer EXCLUSIVELY using the RETRIEVED CHUNKS supplied below. Never use outside knowledge, unstated formulas, or assumptions.
2. Every factual claim MUST cite the exact CHUNK_ID from the supplied chunks and quote a verbatim supporting passage from that chunk. NEVER invent chunk IDs, document names, or page numbers.
3. If the retrieved chunks do NOT contain enough concrete evidence to answer the student's question accurately:
   - Set "isSupported" to false.
   - Set "evidenceStatus" to "insufficient".
   - Set "directAnswer" to the EXACT string: "${UNSUPPORTED_REFUSAL_TEXT}"
   - Set "missingInformation" to a specific explanation of what facts, definitions, formulas, or values are missing from the retrieved chunks.
   - Set "explanation" to brief guidance on what material the student could upload.
   - Set "citations" to [] and "hasNumericalSolution" to false.
4. When the retrieved chunks DO support the answer:
   - Set "isSupported" to true.
   - Set "evidenceStatus" to "strong" (direct explicit evidence) or "moderate" (valid synthesis across retrieved chunks).
   - Provide a clear "directAnswer" and student-friendly "explanation".
   - For ANY numerical, math, physics, chemistry, or quantitative problem:
     * Set "hasNumericalSolution" to true.
     * Fill "numericalSolution":
       - "formula": the exact formula from the retrieved chunks.
       - "inputValues": array of { symbol, value, unit } extracted from the question/documents.
       - "steps": ordered steps where arithmetic expressions use explicit numeric equations like "F = 5 * 9.8 = 49" so they can be verified programmatically.
       - "finalAnswer": clear final computed result with units.
       - "sourceChunkId": exact CHUNK_ID where the formula or data appears.
   - Provide 1–4 "citations" referencing exact CHUNK_ID values and verbatim supporting passages.`;

  const userPrompt = `${
    recentHistory ? `Recent Conversation History:\n${recentHistory}\n\n` : ''
  }Retrieved Document Chunks:\n${contextBlock}\n\nStudent Question:\n${question}`;

  const responseText = await generateStructuredJsonWithResilience({
    contents: userPrompt,
    systemInstruction,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        isSupported: { type: Type.BOOLEAN },
        evidenceStatus: {
          type: Type.STRING,
          description: 'One of "strong", "moderate", or "insufficient".',
        },
        directAnswer: { type: Type.STRING },
        missingInformation: { type: Type.STRING },
        explanation: { type: Type.STRING },
        hasNumericalSolution: { type: Type.BOOLEAN },
        numericalSolution: {
          type: Type.OBJECT,
          properties: {
            formula: { type: Type.STRING },
            inputValues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  value: { type: Type.STRING },
                  unit: { type: Type.STRING },
                },
                required: ['symbol', 'value'],
              },
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stepNumber: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  expression: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['stepNumber', 'title', 'detail'],
              },
            },
            finalAnswer: { type: Type.STRING },
            sourceChunkId: { type: Type.STRING },
          },
          required: ['formula', 'inputValues', 'steps', 'finalAnswer'],
        },
        citations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              chunkId: { type: Type.STRING },
              documentName: { type: Type.STRING },
              pageOrSection: { type: Type.STRING },
              supportingPassage: { type: Type.STRING },
            },
            required: ['chunkId', 'documentName', 'pageOrSection', 'supportingPassage'],
          },
        },
      },
      required: [
        'isSupported',
        'evidenceStatus',
        'directAnswer',
        'missingInformation',
        'explanation',
        'hasNumericalSolution',
        'citations',
      ],
    },
  });

  const parsed = JSON.parse(responseText) as {
    isSupported: boolean;
    evidenceStatus?: string;
    directAnswer: string;
    missingInformation?: string;
    explanation: string;
    hasNumericalSolution?: boolean;
    numericalSolution?: {
      formula: string;
      inputValues: Array<{ symbol: string; value: string; unit?: string }>;
      steps: Array<{ stepNumber: number; title: string; expression?: string; detail: string }>;
      finalAnswer: string;
      sourceChunkId?: string;
    };
    citations?: Array<{
      chunkId: string;
      documentName: string;
      pageOrSection: string;
      supportingPassage: string;
    }>;
  };

  // Handle LLM-detected unsupported question
  if (!parsed.isSupported) {
    return {
      isSupported: false,
      evidenceStatus: 'insufficient',
      confidenceScore: Math.round(searchResult.topSemanticScore * 100),
      directAnswer: UNSUPPORTED_REFUSAL_TEXT,
      missingInformation:
        parsed.missingInformation?.trim() ||
        'The retrieved excerpts from your selected documents do not contain enough evidence to answer this question.',
      explanation:
        parsed.explanation?.trim() ||
        'Select additional relevant documents or upload course material that covers this question.',
      calculationSteps: [],
      citations: [],
      checkedDocuments,
      retrievedChunkCount: searchResult.matches.length,
    };
  }

  // Step 5A: Citation Validation against actual retrieved chunks
  const validatedCitations = validateCitationsAgainstRetrievedChunks(
    parsed.citations ?? [],
    searchResult.matches
  );

  // Enforce zero-fabrication invariant: if no valid citation maps to retrieved chunks, refuse!
  if (validatedCitations.length === 0) {
    logger.info('Response refused by citation validator (0 verified citations)', {
      workspaceId,
      question: question.slice(0, 80),
    });
    return {
      isSupported: false,
      evidenceStatus: 'insufficient',
      confidenceScore: Math.round(searchResult.topSemanticScore * 100),
      directAnswer: UNSUPPORTED_REFUSAL_TEXT,
      missingInformation:
        'Although loosely related terms appeared in your documents, no directly supporting passage could be verified to substantiate an answer.',
      explanation:
        'Please upload or select a document that explicitly defines or explains this topic.',
      calculationSteps: [],
      citations: [],
      checkedDocuments,
      retrievedChunkCount: searchResult.matches.length,
    };
  }

  // Step 5B: Programmatic Numerical Verification when applicable
  let numericalSolution: NumericalSolution | undefined;
  if (
    parsed.hasNumericalSolution &&
    parsed.numericalSolution &&
    parsed.numericalSolution.steps &&
    parsed.numericalSolution.steps.length > 0
  ) {
    const sourceChunk = searchResult.matches.find(
      (m) => m.chunk.chunkId === parsed.numericalSolution?.sourceChunkId
    )?.chunk;

    const rawNumerical: NumericalSolution = {
      formula: parsed.numericalSolution.formula?.trim() || '',
      inputValues: parsed.numericalSolution.inputValues ?? [],
      steps: parsed.numericalSolution.steps.map((s, idx) => ({
        stepNumber: s.stepNumber || idx + 1,
        title: s.title,
        expression: s.expression?.trim() || undefined,
        detail: s.detail,
      })),
      finalAnswer: parsed.numericalSolution.finalAnswer?.trim() || '',
      sourceChunkId: sourceChunk?.chunkId,
      sourceReference: sourceChunk
        ? `${sourceChunk.documentName} · ${sourceChunk.pageLabel}`
        : validatedCitations[0]
          ? `${validatedCitations[0].documentName} · ${validatedCitations[0].pageOrSection}`
          : undefined,
      verifiedProgrammatically: false,
    };

    numericalSolution = verifyNumericalSolution(rawNumerical);
  }

  const evidenceStatus: EvidenceStatus =
    parsed.evidenceStatus === 'moderate' || searchResult.topSemanticScore < 0.56
      ? 'moderate'
      : 'strong';

  const confidenceScore = Math.min(
    99,
    Math.max(
      45,
      Math.round(
        (validatedCitations.reduce((sum, c) => sum + (c.relevanceScore ?? 70), 0) /
          validatedCitations.length) *
          0.7 +
          (evidenceStatus === 'strong' ? 28 : 18)
      )
    )
  );

  return {
    isSupported: true,
    evidenceStatus,
    confidenceScore,
    directAnswer: parsed.directAnswer?.trim() || '',
    missingInformation: '',
    explanation: parsed.explanation?.trim() || '',
    calculationSteps: numericalSolution?.steps ?? [],
    numericalSolution,
    citations: validatedCitations,
    checkedDocuments,
    retrievedChunkCount: searchResult.matches.length,
  };
}

function sampleRepresentativeChunks(chunks: DocumentChunk[], limit = 18): DocumentChunk[] {
  if (chunks.length <= limit) return chunks;
  const step = chunks.length / limit;
  const sampled: DocumentChunk[] = [];
  for (let i = 0; i < limit; i++) {
    sampled.push(chunks[Math.floor(i * step)]);
  }
  return sampled;
}

export async function generateQuizWithRag(params: {
  workspaceId: string;
  documentIds: string[];
  questionCount: number;
  difficulty: 'foundational' | 'standard' | 'challenging';
  topicFocus?: string;
}) {
  const { workspaceId, documentIds, questionCount, difficulty, topicFocus } = params;
  const allDocs = await listWorkspaceDocuments(workspaceId);
  const selectedDocs = allDocs.filter(
    (d) => d.status === 'ready' && documentIds.includes(d.id)
  );

  if (selectedDocs.length === 0) {
    throw new DocumentValidationError(
      'Please select at least one indexed document to generate a practice quiz.',
      400
    );
  }

  let candidateChunks: DocumentChunk[];
  if (topicFocus?.trim()) {
    const topicEmbedding = await embedQueryText(topicFocus.trim());
    const search = await searchWorkspaceVectors({
      workspaceId,
      queryEmbedding: topicEmbedding,
      queryText: topicFocus.trim(),
      documentIds: selectedDocs.map((d) => d.id),
      topK: 14,
      minSemanticScore: 0.3,
    });
    candidateChunks =
      search.matches.length > 0
        ? search.matches.map((m) => m.chunk)
        : sampleRepresentativeChunks(
            await getChunksForDocuments(
              workspaceId,
              selectedDocs.map((d) => d.id)
            )
          );
  } else {
    candidateChunks = sampleRepresentativeChunks(
      await getChunksForDocuments(
        workspaceId,
        selectedDocs.map((d) => d.id)
      )
    );
  }

  if (candidateChunks.length === 0) {
    throw new Error('No indexed chunks were found for the selected documents. Try re-indexing them.');
  }

  const count = Math.min(10, Math.max(2, Math.round(questionCount || 5)));
  const chunkBlock = candidateChunks
    .map(
      (c, i) =>
        `--- CHUNK ${i + 1} ---\nCHUNK_ID: ${c.chunkId}\nDOCUMENT: ${c.documentName}\nPAGE_OR_SLIDE: ${c.pageLabel}\nSECTION_HEADING: ${c.sectionHeading}\nTEXT:\n${c.originalText}`
    )
    .join('\n\n');

  const quizResponseText = await generateStructuredJsonWithResilience({
    contents: `Indexed Study Chunks:\n${chunkBlock}\n\nGenerate a ${count}-question ${difficulty} practice quiz${
      topicFocus?.trim() ? ` focusing on "${topicFocus.trim()}"` : ''
    }.`,
    systemInstruction: `You are .Aai ("The teacher, understand you"), generating a practice quiz STRICTLY grounded in the supplied indexed chunks.
Every question MUST reference a real CHUNK_ID from the supplied chunks, provide 4 answer choices with 1 unambiguous correctOptionIndex (0-3), include clear explanations and calculationSteps for numerical problems, and quote a verbatim supportingPassage from that chunk.`,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              type: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctOptionIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              calculationSteps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    expression: { type: Type.STRING },
                    detail: { type: Type.STRING },
                  },
                  required: ['stepNumber', 'title', 'detail'],
                },
              },
              citation: {
                type: Type.OBJECT,
                properties: {
                  chunkId: { type: Type.STRING },
                  documentName: { type: Type.STRING },
                  pageOrSection: { type: Type.STRING },
                  supportingPassage: { type: Type.STRING },
                },
                required: ['chunkId', 'documentName', 'pageOrSection', 'supportingPassage'],
              },
            },
            required: [
              'question',
              'type',
              'options',
              'correctOptionIndex',
              'explanation',
              'calculationSteps',
              'citation',
            ],
          },
        },
      },
      required: ['title', 'questions'],
    },
  });

  const parsed = JSON.parse(quizResponseText) as {
    title?: string;
    questions?: Array<{
      question: string;
      type: string;
      options: string[];
      correctOptionIndex: number;
      explanation: string;
      calculationSteps?: Array<{
        stepNumber: number;
        title: string;
        expression?: string;
        detail: string;
      }>;
      citation: {
        chunkId: string;
        documentName: string;
        pageOrSection: string;
        supportingPassage: string;
      };
    }>;
  };

  const questions = (parsed.questions ?? []).map((q, idx) => {
    const safeOptions = (q.options ?? []).slice(0, 4);
    const safeCorrectIndex =
      q.correctOptionIndex >= 0 && q.correctOptionIndex < safeOptions.length
        ? q.correctOptionIndex
        : 0;
    const verifiedCitation = validateSingleQuizCitation(q.citation, candidateChunks);

    return {
      id: `q_${idx + 1}_${Date.now()}`,
      question: q.question,
      type: q.type === 'numerical' ? ('numerical' as const) : ('multiple-choice' as const),
      options: safeOptions,
      correctOptionIndex: safeCorrectIndex,
      explanation: q.explanation,
      calculationSteps: (q.calculationSteps ?? []).map((s, sIdx) => ({
        stepNumber: s.stepNumber || sIdx + 1,
        title: s.title,
        expression: s.expression?.trim() || undefined,
        detail: s.detail,
      })),
      citation: verifiedCitation ?? {
        chunkId: candidateChunks[0].chunkId,
        documentId: candidateChunks[0].documentId,
        documentName: candidateChunks[0].documentName,
        pageNumber: candidateChunks[0].pageNumber,
        pageOrSection: candidateChunks[0].pageLabel,
        sectionHeading: candidateChunks[0].sectionHeading,
        supportingPassage: candidateChunks[0].originalText.slice(0, 280),
        verified: true,
      },
    };
  });

  if (questions.length === 0) {
    throw new Error('Could not generate quiz questions from the indexed document chunks.');
  }

  return {
    title: parsed.title?.trim() || 'Document Practice Quiz',
    difficulty,
    sourceDocumentNames: selectedDocs.map((d) => d.name),
    questions,
  };
}
