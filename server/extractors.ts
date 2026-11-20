import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import WordExtractor from 'word-extractor';
import { extractScannedPdfWithGemini, type ServerDocumentSegment } from './gemini.ts';

export interface ExtractionResult {
  format: 'PDF' | 'DOC' | 'DOCX' | 'PPT' | 'PPTX';
  unitLabel: 'page' | 'slide' | 'section';
  pageCount: number;
  segments: ServerDocumentSegment[];
}

function cleanWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inferHeading(text: string, fallback: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return fallback;
  const candidate = lines[0];
  if (candidate.length <= 90) {
    return candidate;
  }
  return candidate.slice(0, 84).trim() + '…';
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function splitLongTextIntoSections(
  rawText: string,
  unit: 'section' | 'page' = 'section',
  chunkSize = 1800
): ServerDocumentSegment[] {
  const cleaned = cleanWhitespace(rawText);
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const segments: ServerDocumentSegment[] = [];
  let buffer = '';
  let idx = 1;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    const prefix = unit === 'page' ? 'Page' : 'Section';
    segments.push({
      pageOrSlideNumber: idx,
      label: `${prefix} ${idx}`,
      sectionTitle: inferHeading(content, `${prefix} ${idx}`),
      content,
    });
    idx += 1;
    buffer = '';
  };

  for (const para of paragraphs) {
    const looksLikeHeading =
      para.length < 95 &&
      !para.endsWith('.') &&
      /^(chapter|unit|section|part|module|\d+\.|\d+\.\d+|[A-Z][A-Za-z0-9\s:&-]{3,})/i.test(para);

    if (buffer.length > 500 && (buffer.length + para.length > chunkSize || looksLikeHeading)) {
      flush();
    }
    buffer = buffer ? `${buffer}\n\n${para}` : para;
  }
  flush();

  return segments;
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
  const uint8 = new Uint8Array(buffer);
  const result = await extractText(uint8, { mergePages: false });
  const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? '')];

  const segments: ServerDocumentSegment[] = [];
  let totalChars = 0;

  rawPages.forEach((pageText, index) => {
    const cleaned = cleanWhitespace(pageText);
    totalChars += cleaned.length;
    if (cleaned.length > 0) {
      const pageNum = index + 1;
      segments.push({
        pageOrSlideNumber: pageNum,
        label: `Page ${pageNum}`,
        sectionTitle: inferHeading(cleaned, `Page ${pageNum}`),
        content: cleaned,
      });
    }
  });

  // Fallback for scanned/image-only PDFs using Gemini multimodal extraction
  if (totalChars < 40) {
    const ocrSegments = await extractScannedPdfWithGemini(buffer, fileName);
    if (ocrSegments.length > 0) {
      return {
        format: 'PDF',
        unitLabel: 'page',
        pageCount: Math.max(result.totalPages || 0, ocrSegments.length),
        segments: ocrSegments,
      };
    }
    throw new Error(
      'No readable text could be extracted from this PDF. Please ensure the file is not password-protected or blank.'
    );
  }

  return {
    format: 'PDF',
    unitLabel: 'page',
    pageCount: result.totalPages || segments.length,
    segments,
  };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value || '';

  // Parse headings (h1-h4) to construct clean logical sections
  const tokenRegex = /<(h[1-4]|p|li|tr)[^>]*>([\s\S]*?)<\/\1>/gi;
  const segments: ServerDocumentSegment[] = [];
  let currentTitle = 'Introduction';
  let currentBlocks: string[] = [];
  let sectionIdx = 1;

  const stripTags = (str: string) =>
    decodeXmlEntities(str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

  const flushSection = () => {
    const content = cleanWhitespace(currentBlocks.join('\n\n'));
    if (!content) return;
    segments.push({
      pageOrSlideNumber: sectionIdx,
      label: `Section ${sectionIdx}`,
      sectionTitle: currentTitle || `Section ${sectionIdx}`,
      content,
    });
    sectionIdx += 1;
    currentBlocks = [];
  };

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[2]);
    if (!text) continue;

    if (tag.startsWith('h')) {
      if (currentBlocks.length > 0) {
        flushSection();
      }
      currentTitle = text.slice(0, 100);
    } else {
      currentBlocks.push(text);
      if (currentBlocks.join('\n\n').length > 2400) {
        flushSection();
      }
    }
  }
  flushSection();

  if (segments.length === 0) {
    const rawResult = await mammoth.extractRawText({ buffer });
    const fallbackSegments = splitLongTextIntoSections(rawResult.value || '', 'section');
    if (fallbackSegments.length === 0) {
      throw new Error('This DOCX document appears to contain no readable text.');
    }
    return {
      format: 'DOCX',
      unitLabel: 'section',
      pageCount: fallbackSegments.length,
      segments: fallbackSegments,
    };
  }

  return {
    format: 'DOCX',
    unitLabel: 'section',
    pageCount: segments.length,
    segments,
  };
}

async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      return numA - numB;
    });

  if (slidePaths.length === 0) {
    throw new Error('No slides were found inside this PPTX presentation.');
  }

  const extractXmlParagraphs = (xml: string): string[] => {
    const paragraphs: string[] = [];
    const pMatches = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
    for (const pXml of pMatches) {
      const tMatches = pXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
      const line = tMatches
        .map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, '')))
        .join('')
        .trim();
      if (line) {
        paragraphs.push(line);
      }
    }
    return paragraphs;
  };

  const segments: ServerDocumentSegment[] = [];

  for (const slidePath of slidePaths) {
    const slideNum = parseInt(slidePath.match(/slide(\d+)\.xml/i)?.[1] ?? '1', 10);
    const slideXml = await zip.files[slidePath].async('string');
    const lines = extractXmlParagraphs(slideXml);

    // Check matching speaker notes
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesLines: string[] = [];
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async('string');
      notesLines = extractXmlParagraphs(notesXml).filter((l) => !/^\d+$/.test(l));
    }

    const bodyParts = [...lines];
    if (notesLines.length > 0) {
      bodyParts.push(`Speaker Notes: ${notesLines.join(' ')}`);
    }

    const content = cleanWhitespace(bodyParts.join('\n'));
    if (content) {
      segments.push({
        pageOrSlideNumber: slideNum,
        label: `Slide ${slideNum}`,
        sectionTitle: lines[0] ? lines[0].slice(0, 90) : `Slide ${slideNum}`,
        content,
      });
    }
  }

  if (segments.length === 0) {
    throw new Error('This PPTX presentation contains no extractable text content.');
  }

  return {
    format: 'PPTX',
    unitLabel: 'slide',
    pageCount: slidePaths.length,
    segments,
  };
}

function extractRtfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const stripped = raw
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, ' ')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/\{\\\*[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' ');
  return cleanWhitespace(stripped);
}

async function extractDoc(buffer: Buffer): Promise<ExtractionResult> {
  let fullText = '';

  const isRtf = buffer.subarray(0, 5).toString('latin1') === '{\\rtf';
  if (isRtf) {
    fullText = extractRtfText(buffer);
  } else {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    fullText = cleanWhitespace(
      [doc.getHeaders(), doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
        .filter(Boolean)
        .join('\n\n')
    );
  }

  const segments = splitLongTextIntoSections(fullText, 'section');
  if (segments.length === 0) {
    throw new Error('This DOC document contains no readable text content.');
  }

  return {
    format: 'DOC',
    unitLabel: 'section',
    pageCount: segments.length,
    segments,
  };
}

function extractBinaryPptText(buffer: Buffer): string[] {
  // Parse PowerPoint Binary Record headers:
  // TextCharsAtom = 0x0FA0 (UTF-16LE), TextBytesAtom = 0x0FA8 (Latin-1 / Windows-1252)
  const chunks: string[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const recVerAndInst = buffer.readUInt16LE(offset);
    const recType = buffer.readUInt16LE(offset + 2);
    const recLen = buffer.readUInt32LE(offset + 4);
    const recVer = recVerAndInst & 0x0f;

    if (recVer !== 0x0f && (recType === 0x0fa0 || recType === 0x0fa8)) {
      if (recLen > 0 && recLen < 2_000_000 && offset + 8 + recLen <= buffer.length) {
        const slice = buffer.subarray(offset + 8, offset + 8 + recLen);
        const decoded =
          recType === 0x0fa0 ? slice.toString('utf16le') : slice.toString('latin1');
        const cleaned = cleanWhitespace(decoded.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' '));
        if (cleaned.length >= 2) {
          chunks.push(cleaned);
        }
        offset += 8 + recLen;
        continue;
      }
    }
    offset += 1;
  }

  return chunks;
}

async function extractPpt(buffer: Buffer): Promise<ExtractionResult> {
  const textBlocks = extractBinaryPptText(buffer);
  const combined = cleanWhitespace(textBlocks.join('\n\n'));

  if (!combined || combined.length < 10) {
    throw new Error(
      'Unable to extract readable text from this legacy .PPT file. If possible, save it as .PPTX or .PDF and upload again.'
    );
  }

  const segments = splitLongTextIntoSections(combined, 'section', 1200).map((seg, i) => ({
    ...seg,
    label: `Slide Section ${i + 1}`,
  }));

  return {
    format: 'PPT',
    unitLabel: 'slide',
    pageCount: segments.length,
    segments,
  };
}

export async function extractDocumentContent(
  buffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  const parts = fileName.split('.');
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';

  switch (ext) {
    case 'pdf':
      return extractPdf(buffer, fileName);
    case 'docx':
      return extractDocx(buffer);
    case 'pptx':
      return extractPptx(buffer);
    case 'doc':
      return extractDoc(buffer);
    case 'ppt':
      return extractPpt(buffer);
    default:
      throw new Error(
        `Unsupported file format ".${ext}". Allowed formats are PDF, DOC, DOCX, PPT, and PPTX.`
      );
  }
}
