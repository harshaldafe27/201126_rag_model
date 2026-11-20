export type SupportedFormat = 'PDF' | 'DOC' | 'DOCX' | 'PPT' | 'PPTX';

export type DocumentStatus =
  | 'uploading'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'processing'
  | 'ready'
  | 'error';

export type EvidenceStatus = 'strong' | 'moderate' | 'insufficient';

export type NavigationSection = 'home' | 'documents' | 'tutor';

export interface DocumentSegment {
  pageOrSlideNumber: number;
  label: string;
  sectionTitle: string;
  content: string;
}

export interface StudyDocument {
  id: string;
  name: string;
  format: SupportedFormat;
  mimeType: string;
  sizeBytes: number;
  contentHash?: string;
  uploadedAt: string;
  lastIndexedAt?: string;
  status: DocumentStatus;
  uploadProgress: number;
  pageCount: number;
  unitLabel: 'page' | 'slide' | 'section';
  chunkCount?: number;
  segments: DocumentSegment[];
  errorMessage?: string;
}

export interface DuplicateUploadConflict {
  id: string;
  file: File;
  existingDocument: StudyDocument;
}

export interface NumericalInputValue {
  symbol: string;
  value: string;
  unit?: string;
}

export interface CalculationStep {
  stepNumber: number;
  title: string;
  expression?: string;
  detail: string;
  verified?: boolean;
  computedValue?: string;
}

export interface NumericalSolution {
  formula: string;
  inputValues: NumericalInputValue[];
  steps: CalculationStep[];
  finalAnswer: string;
  sourceChunkId?: string;
  sourceReference?: string;
  verifiedProgrammatically: boolean;
  verificationNote?: string;
}

export interface Citation {
  chunkId?: string;
  documentId?: string;
  documentName: string;
  pageNumber?: number | null;
  pageOrSection: string;
  sectionHeading?: string;
  supportingPassage: string;
  relevanceScore?: number;
  verified?: boolean;
}

export interface StructuredTutorAnswer {
  isSupported: boolean;
  evidenceStatus?: EvidenceStatus;
  confidenceScore?: number;
  directAnswer: string;
  missingInformation?: string;
  explanation: string;
  calculationSteps: CalculationStep[];
  numericalSolution?: NumericalSolution;
  citations: Citation[];
  checkedDocuments?: string[];
  retrievedChunkCount?: number;
}

export type QuizDifficulty = 'foundational' | 'standard' | 'challenging';

export interface QuizQuestion {
  id: string;
  question: string;
  type: 'multiple-choice' | 'numerical';
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  calculationSteps: CalculationStep[];
  citation: Citation;
}

export interface GeneratedQuiz {
  id: string;
  title: string;
  difficulty: QuizDifficulty;
  sourceDocumentNames: string[];
  questions: QuizQuestion[];
  selectedAnswers: Record<string, number>;
  submitted: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'tutor';
  kind: 'question' | 'answer' | 'quiz';
  createdAt: string;
  text?: string;
  answer?: StructuredTutorAnswer;
  quiz?: GeneratedQuiz;
  scopedDocumentNames?: string[];
  isError?: boolean;
  retryPayload?: {
    question?: string;
    quizConfig?: {
      questionCount: number;
      difficulty: QuizDifficulty;
      topicFocus?: string;
    };
  };
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  selectedDocumentIds: string[];
  messages: ChatMessage[];
}

export interface NotificationItem {
  id: string;
  type: 'error' | 'warning' | 'success' | 'info';
  title: string;
  message: string;
}
