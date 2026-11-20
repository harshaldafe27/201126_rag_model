import type { DocumentChunk, RagCitation, RetrievedChunk } from './types.ts';

export const UNSUPPORTED_REFUSAL_TEXT =
  'Insufficient information in your uploaded documents to answer this question.';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlapRatio(excerpt: string, sourceText: string): number {
  const excerptTokens = normalizeText(excerpt)
    .split(' ')
    .filter((w) => w.length >= 3);
  if (excerptTokens.length === 0) return 0;

  const sourceSet = new Set(normalizeText(sourceText).split(' '));
  let matched = 0;
  for (const tok of excerptTokens) {
    if (sourceSet.has(tok)) matched += 1;
  }
  return matched / excerptTokens.length;
}

function extractBestVerbatimPassage(claimedPassage: string, chunkText: string): string {
  const cleanChunk = chunkText.trim();
  if (!claimedPassage || !claimedPassage.trim()) {
    return cleanChunk.slice(0, 320).trim();
  }

  // Direct substring match (case-insensitive)
  const lowerChunk = cleanChunk.toLowerCase();
  const lowerClaim = claimedPassage.trim().toLowerCase();
  const directIdx = lowerChunk.indexOf(lowerClaim.slice(0, Math.min(80, lowerClaim.length)));
  if (directIdx !== -1) {
    const endIdx = Math.min(cleanChunk.length, directIdx + Math.max(claimedPassage.length + 40, 260));
    return cleanChunk.slice(directIdx, endIdx).trim();
  }

  // If high token overlap (>= 65%), keep the clean quoted excerpt; otherwise snap to best real sentences
  const overlap = tokenOverlapRatio(claimedPassage, cleanChunk);
  if (overlap >= 0.65) {
    return claimedPassage.trim();
  }

  const sentences = cleanChunk.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [cleanChunk];
  let bestSentence = sentences[0] ?? cleanChunk;
  let bestScore = -1;

  for (let i = 0; i < sentences.length; i++) {
    const windowText = sentences.slice(i, i + 2).join(' ').trim();
    const score = tokenOverlapRatio(claimedPassage, windowText);
    if (score > bestScore) {
      bestScore = score;
      bestSentence = windowText;
    }
  }

  return bestSentence.slice(0, 380).trim();
}

export interface RawModelCitation {
  chunkId?: string;
  documentName?: string;
  pageOrSection?: string;
  supportingPassage?: string;
}

export function validateCitationsAgainstRetrievedChunks(
  rawCitations: RawModelCitation[],
  retrievedChunks: RetrievedChunk[]
): RagCitation[] {
  const byId = new Map<string, RetrievedChunk>();
  for (const item of retrievedChunks) {
    byId.set(item.chunk.chunkId, item);
  }

  const verified: RagCitation[] = [];
  const seenKeys = new Set<string>();

  for (const raw of rawCitations) {
    let matched: RetrievedChunk | undefined;

    if (raw.chunkId && byId.has(raw.chunkId.trim())) {
      matched = byId.get(raw.chunkId.trim());
    }

    // Fallback: match by exact document name + strong passage overlap against retrieved chunks ONLY
    if (!matched && raw.supportingPassage) {
      let bestOverlap = 0;
      for (const candidate of retrievedChunks) {
        const sameDoc =
          !raw.documentName ||
          candidate.chunk.documentName.toLowerCase() === raw.documentName.toLowerCase();
        const overlap = tokenOverlapRatio(raw.supportingPassage, candidate.chunk.originalText);
        if (sameDoc && overlap > bestOverlap && overlap >= 0.45) {
          bestOverlap = overlap;
          matched = candidate;
        }
      }
    }

    // Reject fabricated citations that do not map to an actually retrieved chunk
    if (!matched) continue;

    const { chunk, semanticScore } = matched;
    const dedupeKey = `${chunk.chunkId}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const pageOrSection =
      chunk.sectionHeading && chunk.sectionHeading !== chunk.pageLabel
        ? `${chunk.pageLabel} · ${chunk.sectionHeading}`
        : chunk.pageLabel;

    verified.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      pageNumber: chunk.pageNumber,
      pageOrSection,
      sectionHeading: chunk.sectionHeading,
      supportingPassage: extractBestVerbatimPassage(
        raw.supportingPassage ?? '',
        chunk.originalText
      ),
      relevanceScore: Math.round(semanticScore * 100),
      verified: true,
    });
  }

  return verified;
}

export function validateSingleQuizCitation(
  rawCitation: RawModelCitation | undefined,
  availableChunks: DocumentChunk[]
): RagCitation | null {
  if (availableChunks.length === 0) return null;
  const wrapped: RetrievedChunk[] = availableChunks.map((chunk) => ({
    chunk,
    semanticScore: 1,
    lexicalScore: 1,
    combinedScore: 1,
  }));

  if (rawCitation) {
    const validated = validateCitationsAgainstRetrievedChunks([rawCitation], wrapped);
    if (validated.length > 0) return validated[0];
  }

  // Ground fallback strictly to first chunk of matching document if chunkId was omitted
  const docMatch = rawCitation?.documentName
    ? availableChunks.find(
        (c) => c.documentName.toLowerCase() === rawCitation.documentName!.toLowerCase()
      )
    : availableChunks[0];

  const chosen = docMatch ?? availableChunks[0];
  return {
    chunkId: chosen.chunkId,
    documentId: chosen.documentId,
    documentName: chosen.documentName,
    pageNumber: chosen.pageNumber,
    pageOrSection:
      chosen.sectionHeading && chosen.sectionHeading !== chosen.pageLabel
        ? `${chosen.pageLabel} · ${chosen.sectionHeading}`
        : chosen.pageLabel,
    sectionHeading: chosen.sectionHeading,
    supportingPassage: chosen.originalText.slice(0, 320).trim(),
    verified: true,
  };
}

export function evaluateContextSufficiency(params: {
  matches: RetrievedChunk[];
  topSemanticScore: number;
  checkedDocumentNames: string[];
}): { sufficient: boolean; reason?: string } {
  const { matches, topSemanticScore, checkedDocumentNames } = params;

  if (matches.length === 0) {
    return {
      sufficient: false,
      reason: `None of the passages in ${checkedDocumentNames.join(', ')} met the semantic relevance threshold for this question. The uploaded materials appear to cover different topics or lack the specific concept you asked about.`,
    };
  }

  if (topSemanticScore < 0.4) {
    return {
      sufficient: false,
      reason: `The closest retrieved excerpts from ${checkedDocumentNames.join(', ')} had low semantic similarity (${Math.round(
        topSemanticScore * 100
      )}%), indicating that the specific information needed to answer this question is missing from your selected documents.`,
    };
  }

  return { sufficient: true };
}
