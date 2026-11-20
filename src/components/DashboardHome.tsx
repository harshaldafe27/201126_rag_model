import { ArrowRight, Eye, FileText, MessageSquare, Plus } from 'lucide-react';
import { formatFileSize, formatRelativeTime, formatShortDate } from '../lib/validation';
import type { Conversation, DuplicateUploadConflict, StudyDocument } from '../types';
import { DocumentUpload } from './DocumentUpload';
import { StatsCards } from './StatsCards';

interface DashboardHomeProps {
  documents: StudyDocument[];
  conversations: Conversation[];
  duplicateConflicts: DuplicateUploadConflict[];
  totalQuestions: number;
  totalQuizzes: number;
  onFilesSelected: (files: File[]) => void;
  onReindexDuplicate: (conflictId: string) => void;
  onSkipDuplicate: (conflictId: string) => void;
  onViewDocument: (doc: StudyDocument) => void;
  onOpenDocuments: () => void;
  onOpenTutor: () => void;
  onSelectConversation: (conversationId: string) => void;
  onStartNewConversation: () => void;
}

export function DashboardHome({
  documents,
  conversations,
  duplicateConflicts,
  totalQuestions,
  totalQuizzes,
  onFilesSelected,
  onReindexDuplicate,
  onSkipDuplicate,
  onViewDocument,
  onOpenDocuments,
  onOpenTutor,
  onSelectConversation,
  onStartNewConversation,
}: DashboardHomeProps) {
  const readyDocuments = documents.filter((d) => d.status === 'ready');
  const totalVectorChunks = readyDocuments.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              .Aai — AI Based Tutor
            </p>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Welcome to your personal study workspace
            </h1>
            <p className="mt-2 text-sm sm:text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
              The teacher, understand you. Upload your course materials to index semantic chunks,
              receive citation-verified answers with programmatically checked calculations, and
              generate practice quizzes on demand.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenTutor}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              <span>Open AI Tutor</span>
            </button>
            <button
              type="button"
              onClick={onOpenDocuments}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>Manage Library</span>
            </button>
          </div>
        </div>
      </section>

      {/* Statistics Cards */}
      <StatsCards
        totalDocuments={documents.length}
        readyDocuments={readyDocuments.length}
        totalQuestions={totalQuestions}
        totalVectorChunks={totalVectorChunks}
        totalQuizzes={totalQuizzes}
      />

      {/* Quick Action Document Upload */}
      <section aria-label="Quick upload">
        <DocumentUpload
          onFilesSelected={onFilesSelected}
          activeUploads={documents}
          duplicateConflicts={duplicateConflicts}
          onReindexDuplicate={onReindexDuplicate}
          onSkipDuplicate={onSkipDuplicate}
          compact
        />
      </section>

      {/* Recent Documents & Recent Conversations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Documents */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Documents
            </h2>
            <button
              type="button"
              onClick={onOpenDocuments}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              <span>View all</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {documents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <FileText className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                Your library is empty
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Drop a PDF, Word, or PowerPoint file in the uploader above to index and start
                studying.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {documents.slice(0, 5).map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {doc.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span className="font-mono">{doc.format}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono">{formatFileSize(doc.sizeBytes)}</span>
                      {doc.chunkCount ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono">{doc.chunkCount} chunks</span>
                        </>
                      ) : null}
                      <span aria-hidden="true"> · </span>
                      <span>{formatShortDate(doc.uploadedAt)}</span>
                    </p>
                  </div>
                  {doc.status === 'ready' ? (
                    <button
                      type="button"
                      onClick={() => onViewDocument(doc)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>View</span>
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 capitalize whitespace-nowrap shrink-0">
                      {doc.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent Conversations */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Conversations
            </h2>
            <button
              type="button"
              onClick={onStartNewConversation}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New conversation</span>
            </button>
          </div>

          {conversations.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <MessageSquare
                className="h-7 w-7 text-slate-300 dark:text-slate-600"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                No conversations yet
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Once you upload a document, ask questions or generate practice quizzes in the AI
                Tutor.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {conversations.slice(0, 5).map((conv) => {
                const qCount = conv.messages.filter((m) => m.role === 'user').length;
                const quizCount = conv.messages.filter((m) => m.kind === 'quiz').length;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => onSelectConversation(conv.id)}
                      className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {conv.title}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>
                            {qCount} {qCount === 1 ? 'question' : 'questions'}
                          </span>
                          {quizCount > 0 && (
                            <>
                              <span aria-hidden="true"> · </span>
                              <span>
                                {quizCount} {quizCount === 1 ? 'quiz' : 'quizzes'}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true"> · </span>
                          <span>{formatRelativeTime(conv.updatedAt)}</span>
                        </p>
                      </div>
                      <ArrowRight
                        className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
