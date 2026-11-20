import { AlertTriangle, FileUp, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ACCEPT_ATTRIBUTE, formatFileSize, formatShortDate } from '../lib/validation';
import type { DuplicateUploadConflict, StudyDocument } from '../types';

interface DocumentUploadProps {
  onFilesSelected: (files: File[]) => void;
  activeUploads?: StudyDocument[];
  duplicateConflicts?: DuplicateUploadConflict[];
  onReindexDuplicate?: (conflictId: string) => void;
  onSkipDuplicate?: (conflictId: string) => void;
  compact?: boolean;
}

const IN_PROGRESS_STATUSES = new Set([
  'uploading',
  'extracting',
  'chunking',
  'embedding',
  'processing',
]);

export function DocumentUpload({
  onFilesSelected,
  activeUploads = [],
  duplicateConflicts = [],
  onReindexDuplicate,
  onSkipDuplicate,
  compact = false,
}: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = '';
  };

  const inProgressUploads = activeUploads.filter((doc) => IN_PROGRESS_STATUSES.has(doc.status));

  const getProgressLabel = (doc: StudyDocument) => {
    if (doc.status === 'uploading') return `Uploading ${doc.uploadProgress}%`;
    if (doc.status === 'extracting') return 'Extracting text & pages…';
    if (doc.status === 'chunking') return 'Creating semantic chunks…';
    if (doc.status === 'embedding' || doc.status === 'processing') {
      return 'Generating embeddings & indexing…';
    }
    return 'Processing…';
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-xl border-2 border-dashed transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600'
        } ${compact ? 'p-5' : 'p-8 sm:p-10'}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="sr-only"
          aria-label="Select study documents to upload"
        />

        <div
          className={`flex ${
            compact
              ? 'flex-col sm:flex-row sm:items-center sm:justify-between gap-4'
              : 'flex-col items-center text-center'
          }`}
        >
          <div className={`flex ${compact ? 'items-center gap-3.5' : 'flex-col items-center'}`}>
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 ${
                compact ? 'h-11 w-11' : 'h-12 w-12 mb-4'
              }`}
            >
              <FileUp className="h-5 w-5" aria-hidden="true" />
            </div>

            <div>
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                {isDragging ? 'Drop your study files here' : 'Drag and drop study documents'}
              </h3>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Accepted formats: PDF, DOC, DOCX, PPT, PPTX{' '}
                <span aria-hidden="true">·</span> Maximum 10 MB per file{' '}
                <span aria-hidden="true">·</span> Indexed for semantic RAG search
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 whitespace-nowrap shrink-0 ${
              compact ? '' : 'mt-5'
            }`}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Select Files</span>
          </button>
        </div>
      </div>

      {/* Duplicate Document Resolution Prompt */}
      {duplicateConflicts.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20 divide-y divide-amber-200/70 dark:divide-amber-900/50"
        >
          {duplicateConflicts.map((conflict) => (
            <div
              key={conflict.id}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4"
            >
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Duplicate document detected
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    "{conflict.file.name}" matches already indexed document "
                    {conflict.existingDocument.name}" (uploaded{' '}
                    {formatShortDate(conflict.existingDocument.uploadedAt)}
                    {conflict.existingDocument.chunkCount
                      ? ` · ${conflict.existingDocument.chunkCount} chunks`
                      : ''}
                    ). Would you like to re-index it or skip?
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {onReindexDuplicate && (
                  <button
                    type="button"
                    onClick={() => onReindexDuplicate(conflict.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Re-index</span>
                  </button>
                )}
                {onSkipDuplicate && (
                  <button
                    type="button"
                    onClick={() => onSkipDuplicate(conflict.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Skip</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live upload, chunking, and embedding progress list */}
      {inProgressUploads.length > 0 && (
        <div
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800"
          aria-live="polite"
        >
          {inProgressUploads.map((doc) => (
            <div key={doc.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400"
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {doc.name}
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                  {getProgressLabel(doc)}
                </span>
              </div>
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-200"
                  style={{
                    width: `${
                      doc.status === 'uploading' ? Math.max(8, doc.uploadProgress) : 100
                    }%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span>{doc.format}</span>
                <span aria-hidden="true">·</span>
                <span>{formatFileSize(doc.sizeBytes)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
