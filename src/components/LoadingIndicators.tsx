import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

export function InlineSpinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function TutorThinkingIndicator({
  mode = 'answer',
  documentCount,
}: {
  mode?: 'answer' | 'quiz';
  documentCount: number;
}) {
  const headline =
    mode === 'quiz'
      ? 'Crafting practice quiz from your selected documents'
      : 'Analyzing selected study materials and verifying citations';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{headline}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Reviewing {documentCount} selected {documentCount === 1 ? 'document' : 'documents'} for
            exact pages and passages
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="h-3 w-3/4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
      </div>
    </motion.div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading workspace">
      <div className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 animate-pulse" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 animate-pulse"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 animate-pulse" />
        <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 animate-pulse" />
      </div>
    </div>
  );
}
