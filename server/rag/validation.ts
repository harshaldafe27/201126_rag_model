import crypto from 'crypto';
import JSZip from 'jszip';
import type { SupportedFormat } from './types.ts';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx']);

const ALLOWED_MIMES_BY_EXT: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream']),
  doc: new Set([
    'application/msword',
    'application/vnd.ms-word',
    'application/octet-stream',
  ]),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ]),
  ppt: new Set([
    'application/vnd.ms-powerpoint',
    'application/mspowerpoint',
    'application/powerpoint',
    'application/octet-stream',
  ]),
  pptx: new Set([
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/octet-stream',
  ]),
};

export class DocumentValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 422) {
    super(message);
    this.name = 'DocumentValidationError';
    this.statusCode = statusCode;
  }
}

export interface ValidatedFileInfo {
  format: SupportedFormat;
  extension: string;
  mimeType: string;
  contentHash: string;
}

export function isValidWorkspaceId(raw: string | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(raw.trim());
}

export function sanitizeWorkspaceId(raw: string | undefined): string {
  const cleaned = (raw ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleaned.length >= 8 && cleaned.length <= 64) {
    return cleaned;
  }
  return 'ws_default_local';
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hasPdfSignature(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  // Allow optional BOM or leading whitespace within first 1024 bytes per PDF spec
  const headerSlice = buffer.subarray(0, Math.min(1024, buffer.length)).toString('latin1');
  return headerSlice.includes('%PDF-');
}

function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function hasOle2Signature(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  return (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
}

export async function validateUploadedFile(params: {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ValidatedFileInfo> {
  const { originalName, mimeType, buffer } = params;

  if (!originalName || !originalName.trim()) {
    throw new DocumentValidationError('Uploaded file must have a valid filename.', 400);
  }

  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new DocumentValidationError(
      `Unsupported file extension ".${ext || 'unknown'}". Only PDF, DOC, DOCX, PPT, and PPTX files are allowed.`,
      400
    );
  }

  if (!buffer || buffer.length === 0) {
    throw new DocumentValidationError(
      `"${originalName}" is empty (0 bytes) and cannot be indexed.`,
      422
    );
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new DocumentValidationError(
      `"${originalName}" exceeds the maximum allowed size of 10 MB.`,
      413
    );
  }

  const normalizedMime = (mimeType || 'application/octet-stream').toLowerCase().split(';')[0].trim();
  const allowedMimes = ALLOWED_MIMES_BY_EXT[ext];
  if (normalizedMime && allowedMimes && !allowedMimes.has(normalizedMime)) {
    throw new DocumentValidationError(
      `File MIME type "${normalizedMime}" does not match the ".${ext.toUpperCase()}" format.`,
      422
    );
  }

  // Validate binary file signatures (magic bytes & container structure)
  if (ext === 'pdf') {
    if (!hasPdfSignature(buffer)) {
      throw new DocumentValidationError(
        `"${originalName}" does not contain a valid PDF file header. Please upload an authentic PDF document.`,
        422
      );
    }
  } else if (ext === 'docx' || ext === 'pptx') {
    if (!hasZipSignature(buffer)) {
      throw new DocumentValidationError(
        `"${originalName}" is not a valid ${ext.toUpperCase()} OpenXML archive.`,
        422
      );
    }
    try {
      const zip = await JSZip.loadAsync(buffer);
      const hasMarker =
        ext === 'docx'
          ? Boolean(zip.files['word/document.xml'])
          : Object.keys(zip.files).some(
              (k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k) || k === 'ppt/presentation.xml'
            );
      if (!hasMarker) {
        throw new DocumentValidationError(
          `"${originalName}" is missing required internal ${ext.toUpperCase()} document content.`,
          422
        );
      }
    } catch (zipErr) {
      if (zipErr instanceof DocumentValidationError) {
        throw zipErr;
      }
      throw new DocumentValidationError(
        `"${originalName}" appears corrupted and could not be opened as a valid ${ext.toUpperCase()} file.`,
        422
      );
    }
  } else if (ext === 'doc' || ext === 'ppt') {
    // Legacy Office files are OLE2 Compound Binary Files (occasionally RTF for .doc)
    const isRtfDoc = ext === 'doc' && buffer.subarray(0, 5).toString('latin1') === '{\\rtf';
    if (!hasOle2Signature(buffer) && !isRtfDoc) {
      throw new DocumentValidationError(
        `"${originalName}" does not have a valid legacy ${ext.toUpperCase()} binary signature.`,
        422
      );
    }
  }

  return {
    format: ext.toUpperCase() as SupportedFormat,
    extension: ext,
    mimeType: normalizedMime,
    contentHash: computeSha256(buffer),
  };
}
