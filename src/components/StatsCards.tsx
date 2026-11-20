import { ClipboardCheck, Database, FileText, HelpCircle } from 'lucide-react';

interface StatsCardsProps {
  totalDocuments: number;
  readyDocuments: number;
  totalQuestions: number;
  totalVectorChunks: number;
  totalQuizzes: number;
}

export function StatsCards({
  totalDocuments,
  readyDocuments,
  totalQuestions,
  totalVectorChunks,
  totalQuizzes,
}: StatsCardsProps) {
  const stats = [
    {
      label: 'Total Uploaded Documents',
      value: totalDocuments,
      helper:
        totalDocuments === 0
          ? 'PDF, DOC, DOCX, PPT, PPTX'
          : `${readyDocuments} indexed in vector store`,
      icon: FileText,
    },
    {
      label: 'Total Questions Asked',
      value: totalQuestions,
      helper:
        totalQuestions === 0
          ? 'Semantic RAG answers & steps'
          : 'Grounded with verified citations',
      icon: HelpCircle,
    },
    {
      label: 'Indexed Vector Chunks',
      value: totalVectorChunks,
      helper:
        totalVectorChunks === 0
          ? 'Embedded on document upload'
          : 'Searchable semantic passages',
      icon: Database,
    },
    {
      label: 'Practice Quizzes',
      value: totalQuizzes,
      helper:
        totalQuizzes === 0
          ? 'Generate on demand in chat'
          : 'Built from indexed chunks',
      icon: ClipboardCheck,
    },
  ];

  return (
    <section
      aria-label="Workspace statistics"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {stat.label}
              </span>
              <Icon
                className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
            </div>
            <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 tabular-nums">
              {stat.value}
            </p>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {stat.helper}
            </p>
          </div>
        );
      })}
    </section>
  );
}
