export type SupportedFormat = 'PDF' | 'DOC' | 'DOCX' | 'PPT' | 'PPTX';

export type IndexingStatus =
  | 'uploading'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'error';

export type EvidenceStatus = 'strong' | 'moderate' | 'insufficient';

export interface DocumentSegment {
  pageOrSlideNumber: number;
  label: string;
  sectionTitle: string;
  content: string;
}

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  pageLabel: string;
  sectionHeading: string;
  originalText: string;
  chunkIndex: number;
  charCount: number;
}

export interface VectorChunkRecord extends DocumentChunk {
  workspaceId: string;
  embedding: number[];
}

export interface RetrievedChunk {
  chunk: DocumentChunk;
  semanticScore: number;
  lexicalScore: number;
  combinedScore: number;
}

export interface WorkspaceDocumentRecord {
  id: string;
  workspaceId: string;
  name: string;
  format: SupportedFormat;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  storedFileName: string;
  uploadedAt: string;
  lastIndexedAt?: string;
  status: IndexingStatus;
  pageCount: number;
  unitLabel: 'page' | 'slide' | 'section';
  chunkCount: number;
  segments: DocumentSegment[];
  errorMessage?: string;
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

export interface RagCitation {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  pageOrSection: string;
  sectionHeading: string;
  supportingPassage: string;
  relevanceScore?: number;
  verified: boolean;
}

export interface StructuredRagAnswer {
  isSupported: boolean;
  evidenceStatus: EvidenceStatus;
  confidenceScore: number; // 0 to 100
  directAnswer: string;
  missingInformation: string;
  explanation: string;
  calculationSteps: CalculationStep[];
  numericalSolution?: NumericalSolution;
  citations: RagCitation[];
  checkedDocuments: string[];
  retrievedChunkCount: number;
}

export interface HistoryTurn {
  role: 'user' | 'tutor';
  text: string;
}
