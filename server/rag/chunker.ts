import type { DocumentChunk, DocumentSegment } from './types.ts';

const TARGET_CHUNK_CHARS = 900;
const MAX_CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 160;

function splitIntoSentences(text: string): string[] {
  // Split cleanly on paragraph breaks or sentence endings while keeping formulas/decimals intact
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= TARGET_CHUNK_CHARS) {
      units.push(para);
      continue;
    }

    const sentences = para.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [para];
    for (const sentence of sentences) {
      const cleaned = sentence.trim();
      if (cleaned) {
        units.push(cleaned);
      }
    }
  }
  return units;
}

function extractOverlapTail(text: string, maxOverlap: number): string {
  if (text.length <= maxOverlap) return text;
  const tail = text.slice(text.length - maxOverlap);
  const firstSpace = tail.indexOf(' ');
  if (firstSpace > 0 && firstSpace < tail.length - 20) {
    return tail.slice(firstSpace + 1).trim();
  }
  return tail.trim();
}

export function chunkDocumentSegments(params: {
  documentId: string;
  documentName: string;
  segments: DocumentSegment[];
}): DocumentChunk[] {
  const { documentId, documentName, segments } = params;
  const chunks: DocumentChunk[] = [];
  let globalIndex = 1;

  for (const segment of segments) {
    const rawContent = segment.content.trim();
    if (!rawContent) continue;

    const units = splitIntoSentences(rawContent);
    let current = '';

    const pushChunk = (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;

      const chunkId = `${documentId}_ch_${String(globalIndex).padStart(3, '0')}`;
      chunks.push({
        chunkId,
        documentId,
        documentName,
        pageNumber:
          Number.isInteger(segment.pageOrSlideNumber) && segment.pageOrSlideNumber > 0
            ? segment.pageOrSlideNumber
            : null,
        pageLabel: segment.label || `Page ${segment.pageOrSlideNumber}`,
        sectionHeading: segment.sectionTitle || segment.label || 'Untitled Section',
        originalText: normalized,
        chunkIndex: globalIndex,
        charCount: normalized.length,
      });
      globalIndex += 1;
    };

    for (const unit of units) {
      // Handle exceptionally long unbroken single sentences/tables
      if (unit.length > MAX_CHUNK_CHARS) {
        if (current) {
          pushChunk(current);
          current = '';
        }
        let cursor = 0;
        while (cursor < unit.length) {
          const slice = unit.slice(cursor, cursor + TARGET_CHUNK_CHARS);
          pushChunk(slice);
          if (cursor + TARGET_CHUNK_CHARS >= unit.length) break;
          cursor += TARGET_CHUNK_CHARS - OVERLAP_CHARS;
        }
        continue;
      }

      const candidate = current ? `${current}\n\n${unit}` : unit;
      if (candidate.length > TARGET_CHUNK_CHARS && current.length >= 220) {
        pushChunk(current);
        const overlap = extractOverlapTail(current, OVERLAP_CHARS);
        current = overlap ? `${overlap}\n${unit}` : unit;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) {
      pushChunk(current);
    }
  }

  return chunks;
}
