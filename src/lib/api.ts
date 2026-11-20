import type {
  Conversation,
  GeneratedQuiz,
  QuizDifficulty,
  StructuredTutorAnswer,
  StudyDocument,
} from '../types';
import { getWorkspaceId } from './workspace';

function workspaceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'X-Workspace-Id': getWorkspaceId(),
    ...extra,
  };
}

function normalizeServerDocument(raw: Partial<StudyDocument> & { id: string; name: string }): StudyDocument {
  return {
    id: raw.id,
    name: raw.name,
    format: raw.format ?? 'PDF',
    mimeType: raw.mimeType ?? 'application/octet-stream',
    sizeBytes: raw.sizeBytes ?? 0,
    contentHash: raw.contentHash,
    uploadedAt: raw.uploadedAt ?? new Date().toISOString(),
    lastIndexedAt: raw.lastIndexedAt,
    status: raw.status ?? 'ready',
    uploadProgress: raw.status === 'ready' ? 100 : 0,
    pageCount: raw.pageCount ?? 0,
    unitLabel: raw.unitLabel ?? 'page',
    chunkCount: raw.chunkCount ?? 0,
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    errorMessage: raw.errorMessage,
  };
}

export async function fetchDocumentsApi(): Promise<StudyDocument[]> {
  const response = await fetch('/api/documents', {
    headers: workspaceHeaders(),
  });
  const data = (await response.json().catch(() => ({}))) as {
    documents?: Array<Partial<StudyDocument> & { id: string; name: string }>;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || 'Could not load documents from server.');
  }
  return (data.documents ?? []).map(normalizeServerDocument);
}

export type UploadRagResult =
  | { duplicate: true; existingDocument: StudyDocument }
  | { duplicate: false; document: StudyDocument };

export function uploadDocumentWithRag(
  file: File,
  duplicateStrategy: 'prompt' | 'reindex',
  onProgress: (percent: number, stage: 'uploading' | 'embedding') => void
): Promise<UploadRagResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('duplicateStrategy', duplicateStrategy);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(92, Math.round((event.loaded / event.total) * 92));
        onProgress(pct, pct >= 90 ? 'embedding' : 'uploading');
      }
    });

    xhr.upload.addEventListener('load', () => {
      onProgress(95, 'embedding');
    });

    xhr.addEventListener('load', () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }

      if (xhr.status === 409 && data.duplicate && data.existingDocument) {
        resolve({
          duplicate: true,
          existingDocument: normalizeServerDocument(
            data.existingDocument as Partial<StudyDocument> & { id: string; name: string }
          ),
        });
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300 && data.document) {
        onProgress(100, 'embedding');
        resolve({
          duplicate: false,
          document: normalizeServerDocument(
            data.document as Partial<StudyDocument> & { id: string; name: string }
          ),
        });
        return;
      }

      const message =
        typeof data.error === 'string'
          ? data.error
          : `Failed to process "${file.name}" (HTTP ${xhr.status}).`;
      reject(new Error(message));
    });

    xhr.addEventListener('error', () => {
      reject(new Error(`Network error while uploading "${file.name}". Please try again.`));
    });

    xhr.open('POST', '/api/documents/upload');
    xhr.setRequestHeader('X-Workspace-Id', getWorkspaceId());
    xhr.send(formData);
  });
}

export async function reindexDocumentApi(documentId: string): Promise<StudyDocument> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/reindex`, {
    method: 'POST',
    headers: workspaceHeaders(),
  });
  const data = (await response.json().catch(() => ({}))) as {
    document?: Partial<StudyDocument> & { id: string; name: string };
    error?: string;
  };
  if (!response.ok || !data.document) {
    throw new Error(data.error || 'Could not re-index this document.');
  }
  return normalizeServerDocument(data.document);
}

export async function deleteDocumentApi(documentId: string): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Could not delete document from server.');
  }
}

export function getDocumentFileUrl(documentId: string): string {
  const ws = encodeURIComponent(getWorkspaceId());
  return `/api/documents/${encodeURIComponent(documentId)}/file?workspaceId=${ws}`;
}

export async function fetchConversationsApi(): Promise<Conversation[]> {
  const response = await fetch('/api/conversations', {
    headers: workspaceHeaders(),
  });
  const data = (await response.json().catch(() => ({}))) as {
    conversations?: Conversation[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || 'Could not load conversations.');
  }
  return data.conversations ?? [];
}

export async function saveConversationApi(conversation: Conversation): Promise<void> {
  await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
    method: 'PUT',
    headers: workspaceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(conversation),
  });
}

export async function deleteConversationApi(conversationId: string): Promise<void> {
  await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: workspaceHeaders(),
  });
}

export async function askTutorRagApi(params: {
  question: string;
  documentIds: string[];
  history: Array<{ role: 'user' | 'tutor'; text: string }>;
}): Promise<StructuredTutorAnswer> {
  const response = await fetch('/api/rag/ask', {
    method: 'POST',
    headers: workspaceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });

  const data = (await response.json().catch(() => ({}))) as {
    answer?: StructuredTutorAnswer;
    error?: string;
  };

  if (!response.ok || !data.answer) {
    throw new Error(data.error || 'The AI tutor could not generate a grounded response.');
  }

  return data.answer;
}

export async function generateQuizRagApi(params: {
  documentIds: string[];
  questionCount: number;
  difficulty: QuizDifficulty;
  topicFocus?: string;
}): Promise<Omit<GeneratedQuiz, 'id' | 'selectedAnswers' | 'submitted'>> {
  const response = await fetch('/api/rag/quiz', {
    method: 'POST',
    headers: workspaceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });

  const data = (await response.json().catch(() => ({}))) as {
    quiz?: Omit<GeneratedQuiz, 'id' | 'selectedAnswers' | 'submitted'>;
    error?: string;
  };

  if (!response.ok || !data.quiz) {
    throw new Error(data.error || 'Could not generate a practice quiz.');
  }

  return data.quiz;
}
