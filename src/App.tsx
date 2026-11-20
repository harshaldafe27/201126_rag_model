import { Menu, Moon, Sun, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { DashboardHome } from './components/DashboardHome';
import { DocumentList } from './components/DocumentList';
import { DocumentUpload } from './components/DocumentUpload';
import { DocumentViewerModal } from './components/DocumentViewerModal';
import { ErrorNotifications } from './components/ErrorNotifications';
import { WorkspaceSkeleton } from './components/LoadingIndicators';
import { Sidebar } from './components/Sidebar';
import {
  askTutorRagApi,
  deleteConversationApi,
  deleteDocumentApi,
  fetchConversationsApi,
  fetchDocumentsApi,
  generateQuizRagApi,
  reindexDocumentApi,
  saveConversationApi,
  uploadDocumentWithRag,
} from './lib/api';
import {
  deleteConversationRecord,
  deleteDocumentRecord,
  loadAllConversations,
  saveConversationRecord,
  saveDocumentRecord,
} from './lib/storage';
import { createId, validateUploadFile } from './lib/validation';
import type {
  ChatMessage,
  Conversation,
  DuplicateUploadConflict,
  NavigationSection,
  NotificationItem,
  QuizDifficulty,
  StudyDocument,
} from './types';

const SECTION_TITLES: Record<NavigationSection, string> = {
  home: 'Dashboard Home',
  documents: 'Document Library',
  tutor: 'AI Tutor',
};

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [activeSection, setActiveSection] = useState<NavigationSection>('home');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    return 'light';
  });

  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [viewingDocument, setViewingDocument] = useState<StudyDocument | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [duplicateConflicts, setDuplicateConflicts] = useState<DuplicateUploadConflict[]>([]);
  const [reindexingIds, setReindexingIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<'answer' | 'quiz'>('answer');

  const pushNotification = useCallback(
    (type: NotificationItem['type'], title: string, message: string) => {
      const id = createId('notif');
      setNotifications((prev) => [...prev.slice(-3), { id, type, title, message }]);
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((item) => item.id !== id));
      }, 6500);
    },
    []
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Hydrate workspace documents & conversations from local RAG backend (with IndexedDB fallback)
  useEffect(() => {
    let mounted = true;

    Promise.all([
      fetchDocumentsApi().catch(() => [] as StudyDocument[]),
      fetchConversationsApi().catch(() => loadAllConversations().catch(() => [] as Conversation[])),
    ])
      .then(([serverDocs, savedConvs]) => {
        if (!mounted) return;
        setDocuments(serverDocs);
        setConversations(savedConvs);

        const readyIds = serverDocs.filter((d) => d.status === 'ready').map((d) => d.id);
        if (savedConvs.length > 0) {
          const latest = savedConvs[0];
          setActiveConversationId(latest.id);
          const validScoped = latest.selectedDocumentIds.filter((id) => readyIds.includes(id));
          setSelectedDocumentIds(validScoped.length > 0 ? validScoped : readyIds);
        } else {
          setSelectedDocumentIds(readyIds);
        }
        setHydrated(true);
      })
      .catch(() => {
        if (!mounted) return;
        setHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Sync light/dark theme class on <html>
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('aai_theme', next);
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  }, []);

  const readyDocuments = useMemo(
    () => documents.filter((doc) => doc.status === 'ready'),
    [documents]
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const totalQuestions = useMemo(
    () =>
      conversations.reduce(
        (sum, conv) => sum + conv.messages.filter((m) => m.role === 'user').length,
        0
      ),
    [conversations]
  );

  const totalQuizzes = useMemo(
    () =>
      conversations.reduce(
        (sum, conv) => sum + conv.messages.filter((m) => m.kind === 'quiz').length,
        0
      ),
    [conversations]
  );

  const persistConversation = useCallback(async (updated: Conversation) => {
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      const nextList = exists
        ? prev.map((c) => (c.id === updated.id ? updated : c))
        : [updated, ...prev];
      return nextList.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
    await Promise.allSettled([saveConversationApi(updated), saveConversationRecord(updated)]);
  }, []);

  // Upload -> Validate -> Duplicate Check -> Chunk -> Embed -> Vector Store
  const uploadSingleFile = useCallback(
    (file: File, duplicateStrategy: 'prompt' | 'reindex') => {
      const validation = validateUploadFile(file);
      if (!validation.valid || !validation.format) {
        pushNotification('error', 'Upload rejected', validation.error || 'Invalid file.');
        return;
      }

      const tempId = createId('tmp');
      const placeholderDoc: StudyDocument = {
        id: tempId,
        name: file.name,
        format: validation.format,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        status: 'uploading',
        uploadProgress: 5,
        pageCount: 0,
        unitLabel:
          validation.format === 'PDF'
            ? 'page'
            : validation.format.startsWith('PPT')
              ? 'slide'
              : 'section',
        chunkCount: 0,
        segments: [],
      };

      setDocuments((prev) => [placeholderDoc, ...prev]);

      uploadDocumentWithRag(file, duplicateStrategy, (pct, stage) => {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? {
                  ...d,
                  uploadProgress: pct,
                  status: stage === 'embedding' ? 'embedding' : 'uploading',
                }
              : d
          )
        );
      })
        .then(async (result) => {
          if (result.duplicate) {
            // Remove temporary placeholder and surface Re-index / Skip conflict banner
            setDocuments((prev) => prev.filter((d) => d.id !== tempId));
            setDuplicateConflicts((prev) => [
              ...prev.filter((c) => c.existingDocument.id !== result.existingDocument.id),
              {
                id: createId('dup'),
                file,
                existingDocument: result.existingDocument,
              },
            ]);
            pushNotification(
              'warning',
              'Duplicate document detected',
              `"${file.name}" matches "${result.existingDocument.name}". Choose Re-index or Skip.`
            );
            return;
          }

          const readyDoc = result.document;
          setDocuments((prev) => {
            const withoutTempAndOld = prev.filter(
              (d) => d.id !== tempId && d.id !== readyDoc.id
            );
            return [readyDoc, ...withoutTempAndOld];
          });
          setSelectedDocumentIds((prev) =>
            prev.includes(readyDoc.id) ? prev : [...prev, readyDoc.id]
          );

          saveDocumentRecord(readyDoc, file).catch(() => {
            // Best-effort browser cache for offline PDF preview
          });

          pushNotification(
            'success',
            'Document indexed',
            `"${readyDoc.name}" processed (${readyDoc.pageCount} ${readyDoc.unitLabel}${
              readyDoc.pageCount === 1 ? '' : 's'
            } · ${readyDoc.chunkCount ?? 0} semantic chunks).`
          );
        })
        .catch((err: unknown) => {
          const errMessage =
            err instanceof Error ? err.message : `Failed to process "${file.name}".`;
          setDocuments((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? {
                    ...d,
                    status: 'error',
                    uploadProgress: 0,
                    errorMessage: errMessage,
                  }
                : d
            )
          );
          pushNotification('error', 'Indexing failed', errMessage);
        });
    },
    [pushNotification]
  );

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      files.forEach((file) => uploadSingleFile(file, 'prompt'));
    },
    [uploadSingleFile]
  );

  const handleReindexDuplicate = useCallback(
    (conflictId: string) => {
      const target = duplicateConflicts.find((c) => c.id === conflictId);
      if (!target) return;
      setDuplicateConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      uploadSingleFile(target.file, 'reindex');
    },
    [duplicateConflicts, uploadSingleFile]
  );

  const handleSkipDuplicate = useCallback(
    (conflictId: string) => {
      const target = duplicateConflicts.find((c) => c.id === conflictId);
      setDuplicateConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      if (target) {
        pushNotification(
          'info',
          'Upload skipped',
          `Kept existing indexed version of "${target.existingDocument.name}".`
        );
      }
    },
    [duplicateConflicts, pushNotification]
  );

  const handleReindexDocument = useCallback(
    async (docId: string) => {
      setReindexingIds((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
      try {
        const updatedDoc = await reindexDocumentApi(docId);
        setDocuments((prev) => prev.map((d) => (d.id === docId ? updatedDoc : d)));
        setSelectedDocumentIds((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
        pushNotification(
          'success',
          'Re-indexing complete',
          `"${updatedDoc.name}" rebuilt with ${updatedDoc.chunkCount ?? 0} fresh vector chunks.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to re-index document.';
        pushNotification('error', 'Re-indexing failed', msg);
      } finally {
        setReindexingIds((prev) => prev.filter((id) => id !== docId));
      }
    },
    [pushNotification]
  );

  const handleDeleteDocument = useCallback(
    async (docId: string) => {
      const target = documents.find((d) => d.id === docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setSelectedDocumentIds((prev) => prev.filter((id) => id !== docId));
      if (viewingDocument?.id === docId) {
        setViewingDocument(null);
      }

      await Promise.allSettled([deleteDocumentApi(docId), deleteDocumentRecord(docId)]);

      if (target) {
        pushNotification(
          'info',
          'Document & vectors removed',
          `"${target.name}" and its vector index entries were deleted.`
        );
      }
    },
    [documents, viewingDocument, pushNotification]
  );

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      const target = conversations.find((c) => c.id === conversationId);
      if (!target) return;
      setActiveConversationId(target.id);
      const readyIds = readyDocuments.map((d) => d.id);
      const validScoped = target.selectedDocumentIds.filter((id) => readyIds.includes(id));
      setSelectedDocumentIds(validScoped.length > 0 ? validScoped : readyIds);
      setActiveSection('tutor');
    },
    [conversations, readyDocuments]
  );

  const handleNewConversation = useCallback(() => {
    setActiveConversationId(null);
    const readyIds = readyDocuments.map((d) => d.id);
    setSelectedDocumentIds((prev) => {
      const valid = prev.filter((id) => readyIds.includes(id));
      return valid.length > 0 ? valid : readyIds;
    });
    setActiveSection('tutor');
  }, [readyDocuments]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
      }
      await Promise.allSettled([
        deleteConversationApi(conversationId),
        deleteConversationRecord(conversationId),
      ]);
    },
    [activeConversationId]
  );

  const handleAskAboutDocument = useCallback((docId: string) => {
    setActiveConversationId(null);
    setSelectedDocumentIds([docId]);
    setActiveSection('tutor');
  }, []);

  const handleToggleDocumentSelection = useCallback(
    (docId: string) => {
      setSelectedDocumentIds((prev) => {
        const next = prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId];
        if (activeConversation) {
          void persistConversation({
            ...activeConversation,
            selectedDocumentIds: next,
          });
        }
        return next;
      });
    },
    [activeConversation, persistConversation]
  );

  const handleSelectAllDocuments = useCallback(() => {
    const allIds = readyDocuments.map((d) => d.id);
    setSelectedDocumentIds(allIds);
    if (activeConversation) {
      void persistConversation({
        ...activeConversation,
        selectedDocumentIds: allIds,
      });
    }
  }, [readyDocuments, activeConversation, persistConversation]);

  const handleClearDocumentSelection = useCallback(() => {
    setSelectedDocumentIds([]);
    if (activeConversation) {
      void persistConversation({
        ...activeConversation,
        selectedDocumentIds: [],
      });
    }
  }, [activeConversation, persistConversation]);

  const ensureActiveConversation = useCallback(
    (titleSeed: string, scopedIds: string[]): Conversation => {
      if (activeConversation) {
        return {
          ...activeConversation,
          selectedDocumentIds: scopedIds,
        };
      }
      const now = new Date().toISOString();
      const title = titleSeed.length > 56 ? `${titleSeed.slice(0, 56).trim()}…` : titleSeed;
      const newConv: Conversation = {
        id: createId('conv'),
        title,
        createdAt: now,
        updatedAt: now,
        selectedDocumentIds: scopedIds,
        messages: [],
      };
      setActiveConversationId(newConv.id);
      return newConv;
    },
    [activeConversation]
  );

  const handleAskQuestion = useCallback(
    async (question: string) => {
      const scopedDocs = readyDocuments.filter((d) => selectedDocumentIds.includes(d.id));
      if (scopedDocs.length === 0) {
        pushNotification(
          'warning',
          'No documents selected',
          'Select at least one indexed document to ask a question.'
        );
        return;
      }

      const baseConv = ensureActiveConversation(
        question,
        scopedDocs.map((d) => d.id)
      );

      const userMessage: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        kind: 'question',
        createdAt: new Date().toISOString(),
        text: question,
        scopedDocumentNames: scopedDocs.map((d) => d.name),
      };

      const withUserConv: Conversation = {
        ...baseConv,
        updatedAt: userMessage.createdAt,
        messages: [...baseConv.messages, userMessage],
      };

      await persistConversation(withUserConv);
      setIsGenerating(true);
      setGeneratingMode('answer');

      try {
        const recentHistory = baseConv.messages
          .filter((m) => !m.isError && (m.role === 'user' || m.kind === 'answer'))
          .slice(-6)
          .map((m) => ({
            role: m.role,
            text: m.role === 'user' ? m.text || '' : m.answer?.directAnswer || '',
          }));

        const answer = await askTutorRagApi({
          question,
          documentIds: scopedDocs.map((d) => d.id),
          history: recentHistory,
        });

        const tutorMessage: ChatMessage = {
          id: createId('msg'),
          role: 'tutor',
          kind: 'answer',
          createdAt: new Date().toISOString(),
          answer,
        };

        await persistConversation({
          ...withUserConv,
          updatedAt: tutorMessage.createdAt,
          messages: [...withUserConv.messages, tutorMessage],
        });
      } catch (err) {
        const errText =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while running RAG retrieval.';

        const errorMessage: ChatMessage = {
          id: createId('msg'),
          role: 'tutor',
          kind: 'answer',
          createdAt: new Date().toISOString(),
          text: errText,
          isError: true,
          retryPayload: { question },
        };

        await persistConversation({
          ...withUserConv,
          updatedAt: errorMessage.createdAt,
          messages: [...withUserConv.messages, errorMessage],
        });
        pushNotification('error', 'RAG query failed', errText);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      readyDocuments,
      selectedDocumentIds,
      ensureActiveConversation,
      persistConversation,
      pushNotification,
    ]
  );

  const handleGenerateQuiz = useCallback(
    async (config: { questionCount: number; difficulty: QuizDifficulty; topicFocus?: string }) => {
      const scopedDocs = readyDocuments.filter((d) => selectedDocumentIds.includes(d.id));
      if (scopedDocs.length === 0) {
        pushNotification(
          'warning',
          'No documents selected',
          'Select at least one indexed document to generate a practice quiz.'
        );
        return;
      }

      const titleSeed = config.topicFocus
        ? `Quiz: ${config.topicFocus}`
        : `Practice Quiz (${scopedDocs[0].name})`;

      const baseConv = ensureActiveConversation(
        titleSeed,
        scopedDocs.map((d) => d.id)
      );

      const promptSummary = `Generate a ${config.questionCount}-question ${config.difficulty} practice quiz${
        config.topicFocus ? ` focused on "${config.topicFocus}"` : ''
      }.`;

      const userMessage: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        kind: 'question',
        createdAt: new Date().toISOString(),
        text: promptSummary,
        scopedDocumentNames: scopedDocs.map((d) => d.name),
      };

      const withUserConv: Conversation = {
        ...baseConv,
        updatedAt: userMessage.createdAt,
        messages: [...baseConv.messages, userMessage],
      };

      await persistConversation(withUserConv);
      setIsGenerating(true);
      setGeneratingMode('quiz');

      try {
        const rawQuiz = await generateQuizRagApi({
          documentIds: scopedDocs.map((d) => d.id),
          questionCount: config.questionCount,
          difficulty: config.difficulty,
          topicFocus: config.topicFocus,
        });

        const quizMessage: ChatMessage = {
          id: createId('msg'),
          role: 'tutor',
          kind: 'quiz',
          createdAt: new Date().toISOString(),
          quiz: {
            ...rawQuiz,
            id: createId('quiz'),
            selectedAnswers: {},
            submitted: false,
          },
        };

        await persistConversation({
          ...withUserConv,
          updatedAt: quizMessage.createdAt,
          messages: [...withUserConv.messages, quizMessage],
        });
      } catch (err) {
        const errText =
          err instanceof Error
            ? err.message
            : 'Could not generate a practice quiz from the selected documents.';

        const errorMessage: ChatMessage = {
          id: createId('msg'),
          role: 'tutor',
          kind: 'quiz',
          createdAt: new Date().toISOString(),
          text: errText,
          isError: true,
          retryPayload: { quizConfig: config },
        };

        await persistConversation({
          ...withUserConv,
          updatedAt: errorMessage.createdAt,
          messages: [...withUserConv.messages, errorMessage],
        });
        pushNotification('error', 'Quiz generation failed', errText);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      readyDocuments,
      selectedDocumentIds,
      ensureActiveConversation,
      persistConversation,
      pushNotification,
    ]
  );

  const updateQuizMessage = useCallback(
    (messageId: string, updater: (msg: ChatMessage) => ChatMessage) => {
      if (!activeConversation) return;
      const updated: Conversation = {
        ...activeConversation,
        updatedAt: new Date().toISOString(),
        messages: activeConversation.messages.map((m) => (m.id === messageId ? updater(m) : m)),
      };
      void persistConversation(updated);
    },
    [activeConversation, persistConversation]
  );

  const handleSelectQuizAnswer = useCallback(
    (messageId: string, questionId: string, optionIndex: number) => {
      updateQuizMessage(messageId, (msg) => {
        if (!msg.quiz || msg.quiz.submitted) return msg;
        return {
          ...msg,
          quiz: {
            ...msg.quiz,
            selectedAnswers: {
              ...msg.quiz.selectedAnswers,
              [questionId]: optionIndex,
            },
          },
        };
      });
    },
    [updateQuizMessage]
  );

  const handleSubmitQuiz = useCallback(
    (messageId: string) => {
      updateQuizMessage(messageId, (msg) => {
        if (!msg.quiz) return msg;
        return {
          ...msg,
          quiz: {
            ...msg.quiz,
            submitted: true,
          },
        };
      });
    },
    [updateQuizMessage]
  );

  const handleRetakeQuiz = useCallback(
    (messageId: string) => {
      updateQuizMessage(messageId, (msg) => {
        if (!msg.quiz) return msg;
        return {
          ...msg,
          quiz: {
            ...msg.quiz,
            selectedAnswers: {},
            submitted: false,
          },
        };
      });
    },
    [updateQuizMessage]
  );

  const handleOpenDocumentById = useCallback(
    (docId: string) => {
      const found = documents.find((d) => d.id === docId);
      if (found) {
        setViewingDocument(found);
      }
    },
    [documents]
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        documentCount={documents.length}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex flex-1 flex-col min-w-0">
        {/* Contextual Top Bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="lg:hidden font-display text-base font-bold text-slate-900 dark:text-slate-50 whitespace-nowrap">
                .Aai
              </span>
              <span className="lg:hidden text-slate-300 dark:text-slate-700" aria-hidden="true">
                /
              </span>
              <h2 className="truncate text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                {SECTION_TITLES[activeSection]}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            {activeSection !== 'documents' && (
              <button
                type="button"
                onClick={() => setActiveSection('documents')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Upload</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-7xl w-full mx-auto">
          {!hydrated ? (
            <WorkspaceSkeleton />
          ) : activeSection === 'home' ? (
            <DashboardHome
              documents={documents}
              conversations={conversations}
              duplicateConflicts={duplicateConflicts}
              totalQuestions={totalQuestions}
              totalQuizzes={totalQuizzes}
              onFilesSelected={handleFilesSelected}
              onReindexDuplicate={handleReindexDuplicate}
              onSkipDuplicate={handleSkipDuplicate}
              onViewDocument={setViewingDocument}
              onOpenDocuments={() => setActiveSection('documents')}
              onOpenTutor={() => setActiveSection('tutor')}
              onSelectConversation={handleSelectConversation}
              onStartNewConversation={handleNewConversation}
            />
          ) : activeSection === 'documents' ? (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                  Study Documents
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Upload PDF, Word, or PowerPoint study materials. Files are validated, chunked by
                  page and section, embedded with Gemini, and indexed privately for your workspace.
                </p>
              </div>

              <DocumentUpload
                onFilesSelected={handleFilesSelected}
                activeUploads={documents}
                duplicateConflicts={duplicateConflicts}
                onReindexDuplicate={handleReindexDuplicate}
                onSkipDuplicate={handleSkipDuplicate}
              />

              <DocumentList
                documents={documents}
                reindexingIds={reindexingIds}
                onViewDocument={setViewingDocument}
                onReindexDocument={handleReindexDocument}
                onDeleteDocument={handleDeleteDocument}
                onAskAboutDocument={handleAskAboutDocument}
              />
            </div>
          ) : (
            <ChatInterface
              readyDocuments={readyDocuments}
              conversations={conversations}
              activeConversation={activeConversation}
              selectedDocumentIds={selectedDocumentIds}
              onToggleDocumentSelection={handleToggleDocumentSelection}
              onSelectAllDocuments={handleSelectAllDocuments}
              onClearDocumentSelection={handleClearDocumentSelection}
              onSelectConversation={handleSelectConversation}
              onNewConversation={handleNewConversation}
              onDeleteConversation={handleDeleteConversation}
              onAskQuestion={handleAskQuestion}
              onGenerateQuiz={handleGenerateQuiz}
              onSelectQuizAnswer={handleSelectQuizAnswer}
              onSubmitQuiz={handleSubmitQuiz}
              onRetakeQuiz={handleRetakeQuiz}
              onOpenDocument={handleOpenDocumentById}
              onGoToUpload={() => setActiveSection('documents')}
              isGenerating={isGenerating}
              generatingMode={generatingMode}
            />
          )}
        </main>
      </div>

      <DocumentViewerModal
        document={viewingDocument}
        onClose={() => setViewingDocument(null)}
        onAskTutor={handleAskAboutDocument}
      />

      <ErrorNotifications notifications={notifications} onDismiss={dismissNotification} />
    </div>
  );
}
