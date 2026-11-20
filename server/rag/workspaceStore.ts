import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './logger.ts';
import type { WorkspaceDocumentRecord } from './types.ts';

const logger = createLogger('WorkspaceStore');

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_ROOT = path.resolve(PROJECT_ROOT, process.env.RAG_DATA_DIR || '.aai-data');

function getWorkspaceDir(workspaceId: string): string {
  return path.join(DATA_ROOT, 'workspaces', workspaceId);
}

function getDocumentsFile(workspaceId: string): string {
  return path.join(getWorkspaceDir(workspaceId), 'documents.json');
}

function getConversationsFile(workspaceId: string): string {
  return path.join(getWorkspaceDir(workspaceId), 'conversations.json');
}

function getFilesDir(workspaceId: string): string {
  return path.join(getWorkspaceDir(workspaceId), 'files');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listWorkspaceDocuments(
  workspaceId: string
): Promise<WorkspaceDocumentRecord[]> {
  const docs = await readJsonFile<WorkspaceDocumentRecord[]>(getDocumentsFile(workspaceId), []);
  return docs.sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export async function getWorkspaceDocument(
  workspaceId: string,
  documentId: string
): Promise<WorkspaceDocumentRecord | null> {
  const docs = await listWorkspaceDocuments(workspaceId);
  return docs.find((d) => d.id === documentId) ?? null;
}

export async function findDuplicateDocumentByHash(
  workspaceId: string,
  contentHash: string
): Promise<WorkspaceDocumentRecord | null> {
  const docs = await listWorkspaceDocuments(workspaceId);
  return docs.find((d) => d.contentHash === contentHash && d.status !== 'error') ?? null;
}

export async function saveWorkspaceDocument(
  workspaceId: string,
  record: WorkspaceDocumentRecord
): Promise<void> {
  const docs = await listWorkspaceDocuments(workspaceId);
  const exists = docs.some((d) => d.id === record.id);
  const next = exists
    ? docs.map((d) => (d.id === record.id ? record : d))
    : [record, ...docs];
  await writeJsonFile(getDocumentsFile(workspaceId), next);
}

export async function saveOriginalDocumentFile(
  workspaceId: string,
  storedFileName: string,
  buffer: Buffer
): Promise<string> {
  const dir = getFilesDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, path.basename(storedFileName));
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readOriginalDocumentFile(
  workspaceId: string,
  storedFileName: string
): Promise<Buffer> {
  const filePath = path.join(getFilesDir(workspaceId), path.basename(storedFileName));
  return fs.readFile(filePath);
}

export function getOriginalDocumentFilePath(
  workspaceId: string,
  storedFileName: string
): string {
  return path.join(getFilesDir(workspaceId), path.basename(storedFileName));
}

export async function deleteWorkspaceDocumentRecord(
  workspaceId: string,
  documentId: string
): Promise<WorkspaceDocumentRecord | null> {
  const docs = await listWorkspaceDocuments(workspaceId);
  const target = docs.find((d) => d.id === documentId) ?? null;
  if (!target) return null;

  const remaining = docs.filter((d) => d.id !== documentId);
  await writeJsonFile(getDocumentsFile(workspaceId), remaining);

  if (target.storedFileName) {
    const filePath = getOriginalDocumentFilePath(workspaceId, target.storedFileName);
    await fs.unlink(filePath).catch(() => {
      logger.warn('Original file already absent during delete', { workspaceId, documentId });
    });
  }

  return target;
}

// Conversation Persistence
export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  selectedDocumentIds: string[];
  messages: unknown[];
}

export async function listWorkspaceConversations(
  workspaceId: string
): Promise<StoredConversation[]> {
  const items = await readJsonFile<StoredConversation[]>(getConversationsFile(workspaceId), []);
  return items.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function upsertWorkspaceConversation(
  workspaceId: string,
  conversation: StoredConversation
): Promise<void> {
  const items = await listWorkspaceConversations(workspaceId);
  const exists = items.some((c) => c.id === conversation.id);
  const next = exists
    ? items.map((c) => (c.id === conversation.id ? conversation : c))
    : [conversation, ...items];
  await writeJsonFile(getConversationsFile(workspaceId), next);
}

export async function deleteWorkspaceConversation(
  workspaceId: string,
  conversationId: string
): Promise<void> {
  const items = await listWorkspaceConversations(workspaceId);
  const next = items.filter((c) => c.id !== conversationId);
  await writeJsonFile(getConversationsFile(workspaceId), next);
}
