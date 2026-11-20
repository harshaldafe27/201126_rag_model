import {
  AlertCircle,
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatRelativeTime } from '../lib/validation';
import type { Conversation, QuizDifficulty, StudyDocument } from '../types';
import { AnswerCard } from './AnswerCard';
import { TutorThinkingIndicator } from './LoadingIndicators';
import { QuizCard } from './QuizCard';

interface ChatInterfaceProps {
  readyDocuments: StudyDocument[];
  conversations: Conversation[];
  activeConversation: Conversation | null;
  selectedDocumentIds: string[];
  onToggleDocumentSelection: (docId: string) => void;
  onSelectAllDocuments: () => void;
  onClearDocumentSelection: () => void;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onAskQuestion: (question: string) => Promise<void>;
  onGenerateQuiz: (config: {
    questionCount: number;
    difficulty: QuizDifficulty;
    topicFocus?: string;
  }) => Promise<void>;
  onSelectQuizAnswer: (messageId: string, questionId: string, optionIndex: number) => void;
  onSubmitQuiz: (messageId: string) => void;
  onRetakeQuiz: (messageId: string) => void;
  onOpenDocument: (docId: string) => void;
  onGoToUpload: () => void;
  isGenerating: boolean;
  generatingMode: 'answer' | 'quiz';
}

export function ChatInterface({
  readyDocuments,
  conversations,
  activeConversation,
  selectedDocumentIds,
  onToggleDocumentSelection,
  onSelectAllDocuments,
  onClearDocumentSelection,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onAskQuestion,
  onGenerateQuiz,
  onSelectQuizAnswer,
  onSubmitQuiz,
  onRetakeQuiz,
  onOpenDocument,
  onGoToUpload,
  isGenerating,
  generatingMode,
}: ChatInterfaceProps) {
  const [questionInput, setQuestionInput] = useState('');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [quizPanelOpen, setQuizPanelOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [quizCount, setQuizCount] = useState(5);
  const [quizDifficulty, setQuizDifficulty] = useState<QuizDifficulty>('standard');
  const [quizTopicFocus, setQuizTopicFocus] = useState('');
  const [confirmDeleteConvId, setConfirmDeleteConvId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scopeMenuRef = useRef<HTMLDivElement>(null);

  const selectedReadyDocs = readyDocuments.filter((doc) => selectedDocumentIds.includes(doc.id));
  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isGenerating]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (scopeMenuRef.current && !scopeMenuRef.current.contains(e.target as Node)) {
        setScopeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [scopeMenuOpen]);

  const handleSubmitQuestion = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = questionInput.trim();
    if (!trimmed || isGenerating || selectedReadyDocs.length === 0) return;
    setQuestionInput('');
    await onAskQuestion(trimmed);
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmitQuestion();
    }
  };

  const handleCreateQuiz = async (e: FormEvent) => {
    e.preventDefault();
    if (isGenerating || selectedReadyDocs.length === 0) return;
    setQuizPanelOpen(false);
    await onGenerateQuiz({
      questionCount: quizCount,
      difficulty: quizDifficulty,
      topicFocus: quizTopicFocus.trim() || undefined,
    });
    setQuizTopicFocus('');
  };

  const historyList = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3.5">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Chat History
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onNewConversation();
              setHistoryDrawerOpen(false);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Chat</span>
          </button>
          <button
            type="button"
            onClick={() => setHistoryDrawerOpen(false)}
            aria-label="Close chat history"
            className="xl:hidden rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Conversations will be saved here automatically.
          </p>
        ) : (
          conversations.map((conv) => {
            const isActive = activeConversation?.id === conv.id;
            const isConfirming = confirmDeleteConvId === conv.id;
            const questionCount = conv.messages.filter((m) => m.role === 'user').length;

            return (
              <div
                key={conv.id}
                className={`group rounded-lg border transition-colors ${
                  isActive
                    ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900/70 dark:bg-blue-950/40'
                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {isConfirming ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="text-xs text-slate-700 dark:text-slate-300">Delete chat?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteConversation(conv.id);
                          setConfirmDeleteConvId(null);
                        }}
                        className="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteConvId(null)}
                        className="rounded px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 pr-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectConversation(conv.id);
                        setHistoryDrawerOpen(false);
                      }}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                        {conv.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {questionCount} {questionCount === 1 ? 'prompt' : 'prompts'} ·{' '}
                        {formatRelativeTime(conv.updatedAt)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteConvId(conv.id)}
                      aria-label={`Delete conversation ${conv.title}`}
                      className="rounded-md p-1.5 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[540px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Desktop Chat History Rail */}
      <aside className="hidden xl:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800">
        {historyList}
      </aside>

      {/* Mobile / Tablet Chat History Overlay */}
      {historyDrawerOpen && (
        <div className="fixed inset-0 z-40 xl:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setHistoryDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full border-r border-slate-200 dark:border-slate-800">
            {historyList}
          </aside>
        </div>
      )}

      {/* Main Chat Pane */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Chat Workspace Toolbar: History button + Document Scope Selector + Generate Quiz */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50/60 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setHistoryDrawerOpen(true)}
              className="xl:hidden inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span>History</span>
            </button>

            {/* Document Scope Selector Dropdown */}
            <div ref={scopeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setScopeMenuOpen((o) => !o)}
                disabled={readyDocuments.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <span className="tabular-nums">
                  {readyDocuments.length === 0
                    ? 'No documents ready'
                    : selectedReadyDocs.length === readyDocuments.length
                      ? `All ${readyDocuments.length} ${readyDocuments.length === 1 ? 'document' : 'documents'}`
                      : `${selectedReadyDocs.length} of ${readyDocuments.length} selected`}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              </button>

              {scopeMenuOpen && readyDocuments.length > 0 && (
                <div className="absolute left-0 mt-1.5 z-30 w-80 max-w-[85vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Study Document Scope
                    </span>
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={onSelectAllDocuments}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Select all
                      </button>
                      <span className="text-slate-300 dark:text-slate-700">/</span>
                      <button
                        type="button"
                        onClick={onClearDocumentSelection}
                        className="font-medium text-slate-500 dark:text-slate-400 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                    {readyDocuments.map((doc) => {
                      const checked = selectedDocumentIds.includes(doc.id);
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => onToggleDocumentSelection(doc.id)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70"
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              checked
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                              {doc.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {doc.format} · {doc.pageCount} {doc.unitLabel}
                              {doc.pageCount === 1 ? '' : 's'}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setQuizPanelOpen((open) => !open)}
              disabled={selectedReadyDocs.length === 0 || isGenerating}
              title={
                selectedReadyDocs.length === 0
                  ? 'Select at least one document to generate a quiz'
                  : 'Generate a practice quiz from your selected documents'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                quizPanelOpen
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Generate Quiz</span>
            </button>

            <button
              type="button"
              onClick={onNewConversation}
              className="xl:hidden inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* Inline On-Demand Quiz Configurator */}
        {quizPanelOpen && selectedReadyDocs.length > 0 && (
          <form
            onSubmit={handleCreateQuiz}
            className="border-b border-slate-200 dark:border-slate-800 bg-blue-50/40 dark:bg-blue-950/20 px-4 py-3.5"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="quiz-count"
                  className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Questions
                </label>
                <div
                  id="quiz-count"
                  className="inline-flex items-center gap-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5"
                >
                  {[3, 5, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuizCount(num)}
                      className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium tabular-nums transition-colors ${
                        quizCount === num
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Difficulty
                </label>
                <div className="inline-flex items-center gap-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5">
                  {(['foundational', 'standard', 'challenging'] as QuizDifficulty[]).map((diff) => (
                    <button
                      key={diff}
                      type="button"
                      onClick={() => setQuizDifficulty(diff)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                        quizDifficulty === diff
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-w-[180px]">
                <label
                  htmlFor="quiz-topic"
                  className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1"
                >
                  Optional Topic Focus
                </label>
                <input
                  id="quiz-topic"
                  type="text"
                  value={quizTopicFocus}
                  onChange={(e) => setQuizTopicFocus(e.target.value)}
                  placeholder="e.g., Chapter 3 formulas or definitions…"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  Create Quiz
                </button>
                <button
                  type="button"
                  onClick={() => setQuizPanelOpen(false)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Conversation Timeline */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 bg-slate-50/40 dark:bg-slate-950/30">
          {readyDocuments.length === 0 ? (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center py-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
                Upload study materials to begin
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                .Aai answers strictly from your uploaded PDF, Word, and PowerPoint files—showing
                exact page citations, calculation steps, and custom practice quizzes.
              </p>
              <button
                type="button"
                onClick={onGoToUpload}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Upload Documents</span>
              </button>
            </div>
          ) : messages.length === 0 && !isGenerating ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                <MessageSquare className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
                Ask .Aai anything from your selected documents
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Every response includes a direct answer, conceptual explanation, step-by-step math
                when needed, and expandable source passages with page or slide numbers.
              </p>
              {selectedReadyDocs.length > 0 ? (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  Active scope:{' '}
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedReadyDocs.map((d) => d.name).join(' · ')}
                  </span>
                </p>
              ) : (
                <p className="mt-4 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Select at least one document above to enable questions and quiz generation.
                </p>
              )}
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl bg-blue-600 px-4 py-3 text-sm leading-relaxed text-white">
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                        {msg.scopedDocumentNames && msg.scopedDocumentNames.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-blue-100/90">
                            Scope: {msg.scopedDocumentNames.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }

                if (msg.isError) {
                  return (
                    <div
                      key={msg.id}
                      role="alert"
                      className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-4 flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <AlertCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                            Unable to complete request
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                            {msg.text}
                          </p>
                        </div>
                      </div>
                      {msg.retryPayload && (
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => {
                            if (msg.retryPayload?.question) {
                              void onAskQuestion(msg.retryPayload.question);
                            } else if (msg.retryPayload?.quizConfig) {
                              void onGenerateQuiz(msg.retryPayload.quizConfig);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  );
                }

                if (msg.kind === 'quiz' && msg.quiz) {
                  return (
                    <QuizCard
                      key={msg.id}
                      quiz={msg.quiz}
                      onSelectAnswer={(qId, optIdx) => onSelectQuizAnswer(msg.id, qId, optIdx)}
                      onSubmitQuiz={() => onSubmitQuiz(msg.id)}
                      onRetakeQuiz={() => onRetakeQuiz(msg.id)}
                      onOpenDocument={onOpenDocument}
                    />
                  );
                }

                if (msg.kind === 'answer' && msg.answer) {
                  return (
                    <AnswerCard
                      key={msg.id}
                      answer={msg.answer}
                      createdAt={msg.createdAt}
                      onOpenDocument={onOpenDocument}
                    />
                  );
                }

                return null;
              })}

              {isGenerating && (
                <TutorThinkingIndicator
                  mode={generatingMode}
                  documentCount={selectedReadyDocs.length}
                />
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Question Composer */}
        <form
          onSubmit={handleSubmitQuestion}
          className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4"
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-2 focus-within:border-blue-500 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:ring-2 focus-within:ring-blue-600/20 transition-colors">
              <textarea
                rows={1}
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                disabled={readyDocuments.length === 0 || selectedReadyDocs.length === 0 || isGenerating}
                placeholder={
                  readyDocuments.length === 0
                    ? 'Upload a study document first to ask questions…'
                    : selectedReadyDocs.length === 0
                      ? 'Select one or more documents above to ask a question…'
                      : 'Ask a conceptual or numerical question from your selected documents…'
                }
                className="max-h-36 min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={
                  !questionInput.trim() ||
                  selectedReadyDocs.length === 0 ||
                  isGenerating
                }
                aria-label="Send question"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Ask</span>
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              Press Enter to ask · Shift + Enter for a new line · Answers are strictly limited to
              your selected documents
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
