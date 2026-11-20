import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatFileSize, formatShortDate } from '../lib/validation';
import type { StudyDocument } from '../types';

type FormatFilter = 'ALL' | 'PDF' | 'WORD' | 'SLIDES';

interface DocumentListProps {
  documents: StudyDocument[];
  reindexingIds?: string[];
  onViewDocument: (doc: StudyDocument) => void;
  onReindexDocument: (docId: string) => void;
  onDeleteDocument: (docId: string) => void;
  onAskAboutDocument: (docId: string) => void;
}

export function DocumentList({
  documents,
  reindexingIds = [],
  onViewDocument,
  onReindexDocument,
  onDeleteDocument,
  onAskAboutDocument,
}: DocumentListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (q && !doc.name.toLowerCase().includes(q)) return false;
      if (formatFilter === 'PDF') return doc.format === 'PDF';
      if (formatFilter === 'WORD') return doc.format === 'DOC' || doc.format === 'DOCX';
      if (formatFilter === 'SLIDES') return doc.format === 'PPT' || doc.format === 'PPTX';
      return true;
    });
  }, [documents, searchQuery, formatFilter]);

  const filterTabs: Array<{ id: FormatFilter; label: string }> = [
    { id: 'ALL', label: 'All Files' },
    { id: 'PDF', label: 'PDF' },
    { id: 'WORD', label: 'Word' },
    { id: 'SLIDES', label: 'Slides' },
  ];

  const renderStatus = (doc: StudyDocument, isReindexing: boolean) => {
    if (isReindexing) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>Re-indexing</span>
        </span>
      );
    }
    if (doc.status === 'ready') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Indexed</span>
        </span>
      );
    }
    if (doc.status === 'uploading') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap tabular-nums">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>Uploading {doc.uploadProgress}%</span>
        </span>
      );
    }
    if (
      doc.status === 'extracting' ||
      doc.status === 'chunking' ||
      doc.status === 'embedding' ||
      doc.status === 'processing'
    ) {
      const stageText =
        doc.status === 'extracting'
          ? 'Extracting'
          : doc.status === 'chunking'
            ? 'Chunking'
            : 'Embedding';
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>{stageText}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Failed</span>
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search uploaded documents…"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>

        <div
          role="tablist"
          aria-label="Filter documents by format"
          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 p-1 self-start sm:self-auto"
        >
          {filterTabs.map((tab) => {
            const active = formatFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFormatFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty states */}
      {documents.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
            No documents uploaded yet
          </h3>
          <p className="mt-1 max-w-sm mx-auto text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Upload your lecture slides, textbooks, or study notes above to chunk, embed, and start
            asking source-verified questions.
          </p>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No matching documents
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Try adjusting your search query or format filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFormatFilter('ALL');
            }}
            className="mt-3 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 pl-5 pr-4">Document</th>
                <th className="py-3 px-4 hidden sm:table-cell">Format</th>
                <th className="py-3 px-4 hidden md:table-cell">Uploaded</th>
                <th className="py-3 px-4">Index Status</th>
                <th className="py-3 pl-4 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {filteredDocuments.map((doc) => {
                const isConfirming = confirmDeleteId === doc.id;
                const isReindexing = reindexingIds.includes(doc.id);
                const unitText =
                  doc.pageCount > 0
                    ? `${doc.pageCount} ${doc.unitLabel}${doc.pageCount === 1 ? '' : 's'}`
                    : null;
                const chunkText =
                  doc.chunkCount && doc.chunkCount > 0
                    ? `${doc.chunkCount} ${doc.chunkCount === 1 ? 'chunk' : 'chunks'}`
                    : null;

                return (
                  <tr
                    key={doc.id}
                    className="group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-3.5 pl-5 pr-4 max-w-xs sm:max-w-md">
                      <div className="flex items-start gap-3">
                        <FileText
                          className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                            {doc.name}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            <span className="sm:hidden font-mono">{doc.format}</span>
                            <span className="sm:hidden" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono">{formatFileSize(doc.sizeBytes)}</span>
                            {unitText && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{unitText}</span>
                              </>
                            )}
                            {chunkText && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">{chunkText}</span>
                              </>
                            )}
                          </div>
                          {doc.status === 'error' && doc.errorMessage && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                              {doc.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 hidden sm:table-cell font-mono text-xs text-slate-600 dark:text-slate-300">
                      {doc.format}
                    </td>

                    <td className="py-3.5 px-4 hidden md:table-cell text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {formatShortDate(doc.uploadedAt)}
                    </td>

                    <td className="py-3.5 px-4">{renderStatus(doc, isReindexing)}</td>

                    <td className="py-3.5 pl-4 pr-5 text-right whitespace-nowrap">
                      {isConfirming ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            Delete &amp; clear vectors?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteDocument(doc.id);
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors whitespace-nowrap"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          {doc.status === 'ready' && !isReindexing && (
                            <>
                              <button
                                type="button"
                                onClick={() => onViewDocument(doc)}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                              >
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>View</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onAskAboutDocument(doc.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors whitespace-nowrap"
                              >
                                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                                <span className="hidden xl:inline">Ask Tutor</span>
                              </button>
                            </>
                          )}
                          {(doc.status === 'ready' || doc.status === 'error') && (
                            <button
                              type="button"
                              disabled={isReindexing}
                              onClick={() => onReindexDocument(doc.id)}
                              title="Rebuild chunks and embeddings from original file"
                              aria-label={`Re-index ${doc.name}`}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${isReindexing ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                              <span className="hidden 2xl:inline">Re-index</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isReindexing}
                            onClick={() => setConfirmDeleteId(doc.id)}
                            aria-label={`Delete ${doc.name}`}
                            className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
