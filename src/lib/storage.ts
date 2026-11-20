import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Conversation, StudyDocument } from '../types';

interface AaiDatabase extends DBSchema {
  documents: {
    key: string;
    value: StudyDocument;
  };
  documentBlobs: {
    key: string;
    value: {
      id: string;
      blob: Blob;
    };
  };
  conversations: {
    key: string;
    value: Conversation;
  };
}

const DB_NAME = 'aai-tutor-workspace';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AaiDatabase>> | null = null;

function getDb(): Promise<IDBPDatabase<AaiDatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<AaiDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) {
          db.createObjectStore('documents', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('documentBlobs')) {
          db.createObjectStore('documentBlobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadAllDocuments(): Promise<StudyDocument[]> {
  const db = await getDb();
  const docs = await db.getAll('documents');
  return docs.sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export async function saveDocumentRecord(doc: StudyDocument, blob?: Blob): Promise<void> {
  const db = await getDb();
  await db.put('documents', doc);
  if (blob) {
    await db.put('documentBlobs', { id: doc.id, blob });
  }
}

export async function loadDocumentBlob(id: string): Promise<Blob | null> {
  const db = await getDb();
  const entry = await db.get('documentBlobs', id);
  return entry?.blob ?? null;
}

export async function deleteDocumentRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('documents', id);
  await db.delete('documentBlobs', id);
}

export async function loadAllConversations(): Promise<Conversation[]> {
  const db = await getDb();
  const conversations = await db.getAll('conversations');
  return conversations.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function saveConversationRecord(conversation: Conversation): Promise<void> {
  const db = await getDb();
  await db.put('conversations', conversation);
}

export async function deleteConversationRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('conversations', id);
}
