import { BookOpen, CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { Citation } from '../types';

interface CitationPanelProps {
  citations: Citation[];
  defaultExpanded?: boolean;
  onOpenDocument?: (documentId: string) => void;
  title?: string;
}

export function CitationPanel({
  citations,
  defaultExpanded = false,
  onOpenDocument,
  title = 'Verified Source References',
}: CitationPanelProps) {
  const [expandedMap, setExpandedMap] = useState<Record<number, boolean>>(() => {
    if (!defaultExpanded) return {};
    const initial: Record<number, boolean> = {};
    citations.forEach((_, idx) => {
      initial[idx] = true;
    });
    return initial;
  });

  if (citations.length === 0) return null;

  const allExpanded = citations.every((_, idx) => Boolean(expandedMap[idx]));

  const toggleIndex = (idx: number) => {
    setExpandedMap((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleAll = () => {
    const nextValue = !allExpanded;
    const next: Record<number, boolean> = {};
    citations.forEach((_, idx) => {
      next[idx] = nextValue;
    });
    setExpandedMap(next);
  };

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <BookOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span>{title}</span>
          <span className="font-mono text-slate-400 dark:text-slate-500 tabular-nums">
            ({citations.length})
          </span>
        </div>

        {citations.length > 1 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 overflow-hidden">
        {citations.map((citation, idx) => {
          const isOpen = Boolean(expandedMap[idx]);
          return (
            <div key={`${citation.chunkId ?? citation.documentName}-${idx}`}>
              <button
                type="button"
                onClick={() => toggleIndex(idx)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-mono font-semibold text-blue-700 dark:text-blue-400 tabular-nums">
                      [{idx + 1}]
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {citation.documentName}
                    </span>
                    <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {citation.pageOrSection}
                    </span>
                    {typeof citation.relevanceScore === 'number' && (
                      <>
                        <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                          {citation.relevanceScore}% match
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                  <span className="hidden sm:inline">{isOpen ? 'Hide passage' : 'View passage'}</span>
                  {isOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.14 }}
                    className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/80 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Supporting extracted passage
                        {citation.chunkId ? (
                          <span className="ml-1.5 font-mono text-slate-400 dark:text-slate-500">
                            · {citation.chunkId}
                          </span>
                        ) : null}
                      </p>
                      {citation.verified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>Verified in chunk</span>
                        </span>
                      )}
                    </div>

                    <blockquote className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 px-3.5 py-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      "{citation.supportingPassage}"
                    </blockquote>

                    {citation.documentId && onOpenDocument && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => onOpenDocument(citation.documentId!)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                        >
                          <span>Inspect document</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
