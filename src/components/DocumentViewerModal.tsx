import { BookOpen, FileText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDocumentFileUrl } from '../lib/api';
import { loadDocumentBlob } from '../lib/storage';
import { formatFileSize, formatShortDate } from '../lib/validation';
import type { StudyDocument } from '../types';

interface DocumentViewerModalProps {
  document: StudyDocument | null;
  onClose: () => void;
  onAskTutor: (docId: string) => void;
}

export function DocumentViewerModal({
  document: doc,
  onClose,
  onAskTutor,
}: DocumentViewerModalProps) {
  const [viewMode, setViewMode] = useState<'extracted' | 'pdf'>('extracted');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    setActiveIndex(0);
    setSearchText('');
    setViewMode('extracted');

    let objectUrl: string | null = null;
    if (doc.format === 'PDF') {
      // Prefer server workspace file endpoint, fallback to IndexedDB blob if present
      const serverUrl = getDocumentFileUrl(doc.id);
      setPdfUrl(serverUrl);
      loadDocumentBlob(doc.id)
        .then((blob) => {
          if (blob) {
            objectUrl = URL.createObjectURL(blob);
            setPdfUrl(objectUrl);
          }
        })
        .catch(() => {
          // Keep server URL
        });
    } else {
      setPdfUrl(null);
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [doc, onClose]);

  const filteredSegments = useMemo(() => {
    if (!doc) return [];
    const q = searchText.trim().toLowerCase();
    if (!q) return doc.segments;
    return doc.segments.filter(
      (s) =>
        s.content.toLowerCase().includes(q) ||
        s.sectionTitle.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q)
    );
  }, [doc, searchText]);

  if (!doc) return null;

  const activeSegment = filteredSegments[activeIndex] ?? filteredSegments[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-viewer-title"
      onClick={onClose}
    >
      <div
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              id="doc-viewer-title"
              className="truncate text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {doc.name}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              <span className="font-mono">{doc.format}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono">{formatFileSize(doc.sizeBytes)}</span>
              <span aria-hidden="true"> · </span>
              <span>
                {doc.pageCount} {doc.unitLabel}
                {doc.pageCount === 1 ? '' : 's'}
              </span>
              {doc.chunkCount ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono">{doc.chunkCount} vector chunks</span>
                </>
              ) : null}
              <span aria-hidden="true"> · </span>
              <span>Uploaded {formatShortDate(doc.uploadedAt)}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pdfUrl && (
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('extracted')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'extracted'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Indexed Text
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('pdf')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === 'pdf'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Original PDF
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                onAskTutor(doc.id);
              }}
              className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              Ask Tutor
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close document viewer"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {viewMode === 'pdf' && pdfUrl ? (
          <div className="flex-1 bg-slate-100 dark:bg-slate-950">
            <iframe
              src={pdfUrl}
              title={`PDF preview of ${doc.name}`}
              className="h-full w-full border-0"
            />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col md:flex-row">
            <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col max-h-48 md:max-h-none">
              <div className="p-3 border-b border-slate-200 dark:border-slate-800">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      setActiveIndex(0);
                    }}
                    placeholder="Find in document…"
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-1.5 pl-8 pr-2.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {filteredSegments.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500 dark:text-slate-400">
                    No sections match "{searchText}".
                  </p>
                ) : (
                  filteredSegments.map((seg, idx) => {
                    const isSelected = activeSegment?.label === seg.label && idx === activeIndex;
                    return (
                      <button
                        key={`${seg.label}-${idx}`}
                        type="button"
                        onClick={() => setActiveIndex(idx)}
                        className={`flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70'
                        }`}
                      >
                        <span className="font-mono text-[11px] font-medium tabular-nums">
                          {seg.label}
                        </span>
                        <span className="mt-0.5 truncate text-xs w-full">{seg.sectionTitle}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeSegment ? (
                <article className="max-w-3xl">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="font-mono tabular-nums">{activeSegment.label}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeSegment.sectionTitle}</span>
                  </div>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-800 dark:text-slate-200">
                    {activeSegment.content}
                  </div>
                </article>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <FileText className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    No extracted content matches your search.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
