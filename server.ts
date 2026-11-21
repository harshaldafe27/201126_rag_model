import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatApiError } from './server/gemini.ts';
import { createLogger } from './server/rag/logger.ts';
import {
  answerQuestionWithRag,
  generateQuizWithRag,
  ingestDocument,
  reindexWorkspaceDocument,
  removeWorkspaceDocument,
} from './server/rag/ragService.ts';
import type { HistoryTurn } from './server/rag/types.ts';
import {
  isValidWorkspaceId,
  MAX_UPLOAD_BYTES,
  sanitizeWorkspaceId,
} from './server/rag/validation.ts';
import {
  deleteWorkspaceConversation,
  getOriginalDocumentFilePath,
  getWorkspaceDocument,
  listWorkspaceConversations,
  listWorkspaceDocuments,
  upsertWorkspaceConversation,
  type StoredConversation,
} from './server/rag/workspaceStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger('HTTP');

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTS.has(ext)) {
      cb(
        new Error(
          `Unsupported file format ".${ext || 'unknown'}". Only PDF, DOC, DOCX, PPT, and PPTX files are allowed.`
        )
      );
      return;
    }
    cb(null, true);
  },
});

function getRawWorkspaceId(req: Request): string | undefined {
  const headerVal = req.header('x-workspace-id');
  if (headerVal) return headerVal;
  if (typeof req.query.workspaceId === 'string') return req.query.workspaceId;
  return undefined;
}

function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  const raw = getRawWorkspaceId(req);
  if (!isValidWorkspaceId(raw)) {
    logger.info('Rejected unauthorized API request with missing/invalid workspace token', {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({
      error:
        'Unauthorized request: a valid X-Workspace-Id header (8–64 alphanumeric, underscore, or hyphen characters) is required.',
    });
    return;
  }
  next();
}

function getWorkspaceId(req: Request): string {
  return sanitizeWorkspaceId(getRawWorkspaceId(req));
}

async function createServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ragPipeline: 'active' });
  });

  // Require valid workspace token on all workspace-isolated RAG APIs
  app.use('/api/documents', requireWorkspace);
  app.use('/api/conversations', requireWorkspace);
  app.use('/api/rag', requireWorkspace);

  // 1. Document Management REST API
  app.get('/api/documents', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const documents = await listWorkspaceDocuments(workspaceId);
      res.json({ documents });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/documents/upload', (req: Request, res: Response) => {
    upload.single('file')(req, res, async (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: 'File exceeds the 10 MB maximum upload limit. Please upload a smaller document.',
          });
          return;
        }
        const message = err instanceof Error ? err.message : 'File upload failed.';
        res.status(400).json({ error: message });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No document file was provided.' });
        return;
      }

      const workspaceId = getWorkspaceId(req);
      const duplicateStrategy =
        req.body?.duplicateStrategy === 'reindex' ? 'reindex' : 'prompt';

      try {
        const result = await ingestDocument({
          workspaceId,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          buffer: req.file.buffer,
          duplicateStrategy,
        });

        if (result.duplicate) {
          res.status(409).json({
            duplicate: true,
            error: `"${req.file.originalname}" matches an already uploaded document ("${result.existingDocument.name}"). Choose Re-index or Skip.`,
            existingDocument: result.existingDocument,
          });
          return;
        }

        res.status(201).json({ document: result.document });
      } catch (ingestErr) {
        const { status, message } = formatApiError(ingestErr);
        const responseStatus = status >= 400 && status < 500 ? status : 422;
        if (status >= 500) {
          logger.error('Upload/ingestion server error', { workspaceId, error: message });
        } else {
          logger.info('Upload validation rejected', {
            workspaceId,
            status: responseStatus,
            reason: message,
          });
        }
        res.status(responseStatus).json({ error: message });
      }
    });
  });

  app.post('/api/documents/:id/reindex', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const documentId = String(req.params.id ?? '').trim();
      if (!documentId) {
        res.status(400).json({ error: 'Document ID is required.' });
        return;
      }

      const document = await reindexWorkspaceDocument(workspaceId, documentId);
      res.json({ document });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status >= 400 && status < 500 ? status : 422).json({ error: message });
    }
  });

  app.get('/api/documents/:id/file', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const documentId = String(req.params.id ?? '').trim();
      const doc = await getWorkspaceDocument(workspaceId, documentId);
      if (!doc || !doc.storedFileName) {
        res.status(404).json({ error: 'Document file not found.' });
        return;
      }

      const filePath = getOriginalDocumentFilePath(workspaceId, doc.storedFileName);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Stored original file is unavailable.' });
        return;
      }

      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.delete('/api/documents/:id', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const documentId = String(req.params.id ?? '').trim();
      if (!documentId) {
        res.status(400).json({ error: 'Document ID is required.' });
        return;
      }

      const outcome = await removeWorkspaceDocument(workspaceId, documentId);
      res.json(outcome);
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Conversation Management REST API
  app.get('/api/conversations', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const conversations = await listWorkspaceConversations(workspaceId);
      res.json({ conversations });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.put('/api/conversations/:id', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const conversation = req.body as StoredConversation;
      if (!conversation || conversation.id !== req.params.id) {
        res.status(400).json({ error: 'Valid conversation payload is required.' });
        return;
      }
      await upsertWorkspaceConversation(workspaceId, conversation);
      res.json({ saved: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.delete('/api/conversations/:id', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const id = String(req.params.id ?? '').trim();
      await deleteWorkspaceConversation(workspaceId, id);
      res.json({ deleted: true });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. RAG Question Answering & Quiz REST API
  app.post('/api/rag/ask', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const { question, documentIds, history } = req.body as {
        question?: string;
        documentIds?: string[];
        history?: HistoryTurn[];
      };

      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'Please enter a valid question.' });
        return;
      }

      if (question.length > 2000) {
        res.status(400).json({ error: 'Question is too long (maximum 2,000 characters).' });
        return;
      }

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        res.status(400).json({
          error: 'Please select at least one indexed document before asking a question.',
        });
        return;
      }

      const answer = await answerQuestionWithRag({
        workspaceId,
        question: question.trim(),
        documentIds,
        history: Array.isArray(history) ? history : [],
      });

      res.json({ answer });
    } catch (err) {
      const { status, message } = formatApiError(err);
      if (status >= 500) {
        logger.error('RAG ask error', { status, error: message });
      } else {
        logger.info('RAG ask rejected', { status, reason: message });
      }
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rag/quiz', async (req: Request, res: Response) => {
    try {
      const workspaceId = getWorkspaceId(req);
      const { documentIds, questionCount, difficulty, topicFocus } = req.body as {
        documentIds?: string[];
        questionCount?: number;
        difficulty?: 'foundational' | 'standard' | 'challenging';
        topicFocus?: string;
      };

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        res.status(400).json({
          error: 'Please select at least one indexed document to generate a practice quiz.',
        });
        return;
      }

      const validDifficulties = new Set(['foundational', 'standard', 'challenging']);
      const safeDifficulty =
        difficulty && validDifficulties.has(difficulty) ? difficulty : 'standard';

      const quiz = await generateQuizWithRag({
        workspaceId,
        documentIds,
        questionCount: Number(questionCount) || 5,
        difficulty: safeDifficulty,
        topicFocus: typeof topicFocus === 'string' ? topicFocus : undefined,
      });

      res.json({ quiz });
    } catch (err) {
      const { status, message } = formatApiError(err);
      if (status >= 500) {
        logger.error('RAG quiz error', { status, error: message });
      } else {
        logger.info('RAG quiz rejected', { status, reason: message });
      }
      res.status(status).json({ error: message });
    }
  });

  // Return JSON 404 for unknown or malformed /api routes instead of falling through to SPA HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, message } = formatApiError(err);
    res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`.Aai RAG server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start .Aai server:', err);
  process.exit(1);
});
