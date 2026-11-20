import { GoogleGenAI, Type } from '@google/genai';

const MODEL_NAME = 'gemini-4-hydrogen';

export const UNSUPPORTED_ANSWER_TEXT =
  'Insufficient information in your uploaded documents to answer this question.';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ServerDocumentSegment {
  pageOrSlideNumber: number;
  label: string;
  sectionTitle: string;
  content: string;
}

export interface ServerDocumentContext {
  id: string;
  name: string;
  format: string;
  segments: ServerDocumentSegment[];
}

export interface HistoryTurn {
  role: 'user' | 'tutor';
  text: string;
}

export function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_invalid') || lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      message:
        'Unable to authenticate with the AI service. Please verify your API key in Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message:
        'The AI service is temporarily rate-limited. Please wait a moment and try again.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 404,
      message: 'The configured AI model is currently unavailable. Please try again shortly.',
    };
  }
  return {
    status: 500,
    message: raw || 'An unexpected error occurred while communicating with the AI tutor.',
  };
}

function buildDocumentContextBlock(documents: ServerDocumentContext[]): string {
  // Keep prompt payload clean and well-indexed so Gemini can quote exact page/slide labels & verbatim excerpts
  const maxTotalChars = 160_000;
  let currentChars = 0;
  const blocks: string[] = [];

  for (const doc of documents) {
    const docHeader = `=== DOCUMENT: "${doc.name}" (Format: ${doc.format}, ID: ${doc.id}) ===`;
    blocks.push(docHeader);
    currentChars += docHeader.length;

    for (const seg of doc.segments) {
      const segHeader = `[${seg.label}${seg.sectionTitle ? ` — ${seg.sectionTitle}` : ''}]`;
      const body = seg.content.trim();
      const entry = `${segHeader}\n${body}\n`;

      if (currentChars + entry.length > maxTotalChars) {
        const remaining = Math.max(0, maxTotalChars - currentChars);
        if (remaining > 300) {
          blocks.push(entry.slice(0, remaining) + '\n...[truncated for length]');
        }
        break;
      }
      blocks.push(entry);
      currentChars += entry.length;
    }

    if (currentChars >= maxTotalChars) {
      break;
    }
  }

  return blocks.join('\n');
}

export async function extractScannedPdfWithGemini(
  buffer: Buffer,
  fileName: string
): Promise<ServerDocumentSegment[]> {
  const ai = getGeminiClient();
  const base64Data = buffer.toString('base64');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data,
          },
        },
        {
          text: `Extract all readable text, formulas, tables, and headings from this PDF ("${fileName}") page by page. Return one structured entry per page with the exact 1-indexed page number, the main section heading on that page (or "Page N" if none), and the complete faithful text content.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pages: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pageNumber: { type: Type.INTEGER },
                sectionTitle: { type: Type.STRING },
                content: { type: Type.STRING },
              },
              required: ['pageNumber', 'sectionTitle', 'content'],
            },
          },
        },
        required: ['pages'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    pages?: Array<{ pageNumber: number; sectionTitle: string; content: string }>;
  };

  const pages = parsed.pages ?? [];
  return pages
    .filter((p) => p.content && p.content.trim().length > 0)
    .map((p, index) => {
      const pageNum = Number.isInteger(p.pageNumber) && p.pageNumber > 0 ? p.pageNumber : index + 1;
      return {
        pageOrSlideNumber: pageNum,
        label: `Page ${pageNum}`,
        sectionTitle: p.sectionTitle?.trim() || `Page ${pageNum}`,
        content: p.content.trim(),
      };
    });
}

export async function askTutorFromDocuments(params: {
  question: string;
  documents: ServerDocumentContext[];
  history: HistoryTurn[];
}) {
  const ai = getGeminiClient();
  const contextText = buildDocumentContextBlock(params.documents);
  const recentHistory = params.history
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.text}`)
    .join('\n');

  const systemInstruction = `You are .Aai ("The teacher, understand you"), an expert, encouraging academic tutor who answers student questions STRICTLY using the provided uploaded study documents.

CRITICAL GROUNDING RULES:
1. You must ONLY rely on facts, definitions, formulas, examples, and data explicitly present in the provided documents. NEVER invent facts or bring in external textbook knowledge that is not supported by the provided text.
2. If the provided documents do NOT contain enough information to answer the student's question accurately, you MUST:
   - Set "isSupported" to false.
   - Set "directAnswer" to the EXACT string: "${UNSUPPORTED_ANSWER_TEXT}"
   - Set "missingInformation" to a clear, helpful explanation describing specifically what facts, formulas, or topic details are missing from the selected documents (and briefly mention what related topics the documents do cover, if any).
   - Set "explanation" to a short guidance note on what document or section the student could upload to answer it.
   - Set "calculationSteps" to an empty array [] and "citations" to an empty array [].
3. When the documents DO support the answer:
   - Set "isSupported" to true.
   - "directAnswer": Provide a crisp, direct, complete answer in 1–3 clear sentences.
   - "explanation": Provide a clear, teacher-like conceptual explanation tailored to help a student genuinely understand the "why" and "how".
   - "calculationSteps": For ANY numerical, mathematical, physics, chemistry, finance, or quantitative question, provide an ordered array of step-by-step calculation steps (stepNumber, title, expression in clean readable math notation, and detail explaining the step). For purely conceptual non-numerical questions, return an empty array [].
   - "citations": Provide 1–4 exact citations from the provided documents. Each citation MUST include:
     * "documentName": exact file name from the DOCUMENT header.
     * "pageOrSection": exact page/slide number and section title (e.g., "Page 4 · Section 2.1: Kinematics" or "Slide 7 · Newton's Second Law").
     * "supportingPassage": a verbatim, faithful excerpt copied directly from that page/section supporting the answer (1–4 sentences).
   - Set "missingInformation" to an empty string "".`;

  const userPrompt = `${
    recentHistory ? `Recent Conversation Context:\n${recentHistory}\n\n` : ''
  }Selected Study Documents:\n${contextText}\n\nStudent Question:\n${params.question}`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isSupported: {
            type: Type.BOOLEAN,
            description:
              'True only if the selected uploaded documents contain enough information to answer the question.',
          },
          directAnswer: {
            type: Type.STRING,
            description:
              'Direct answer to the question, or the exact unsupported notice when isSupported is false.',
          },
          missingInformation: {
            type: Type.STRING,
            description:
              'When isSupported is false, explains specifically what information is missing from the uploaded documents. Empty string otherwise.',
          },
          explanation: {
            type: Type.STRING,
            description: 'Clear conceptual explanation grounded strictly in the documents.',
          },
          calculationSteps: {
            type: Type.ARRAY,
            description: 'Step-by-step mathematical or numerical breakdown when applicable; empty otherwise.',
            items: {
              type: Type.OBJECT,
              properties: {
                stepNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                expression: { type: Type.STRING },
                detail: { type: Type.STRING },
              },
              required: ['stepNumber', 'title', 'detail'],
            },
          },
          citations: {
            type: Type.ARRAY,
            description: 'Exact source citations with page/section and verbatim supporting passages.',
            items: {
              type: Type.OBJECT,
              properties: {
                documentName: { type: Type.STRING },
                pageOrSection: { type: Type.STRING },
                supportingPassage: { type: Type.STRING },
              },
              required: ['documentName', 'pageOrSection', 'supportingPassage'],
            },
          },
        },
        required: [
          'isSupported',
          'directAnswer',
          'missingInformation',
          'explanation',
          'calculationSteps',
          'citations',
        ],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    isSupported: boolean;
    directAnswer: string;
    missingInformation?: string;
    explanation: string;
    calculationSteps?: Array<{
      stepNumber: number;
      title: string;
      expression?: string;
      detail: string;
    }>;
    citations?: Array<{
      documentName: string;
      pageOrSection: string;
      supportingPassage: string;
    }>;
  };

  // Enforce exact required phrasing for unsupported questions
  if (!parsed.isSupported) {
    return {
      isSupported: false,
      directAnswer: UNSUPPORTED_ANSWER_TEXT,
      missingInformation:
        parsed.missingInformation?.trim() ||
        'The selected documents do not include the specific facts, definitions, or figures needed to answer this question.',
      explanation:
        parsed.explanation?.trim() ||
        'Try selecting additional uploaded documents or uploading lecture notes that cover this topic.',
      calculationSteps: [],
      citations: [],
      checkedDocuments: params.documents.map((d) => d.name),
    };
  }

  return {
    isSupported: true,
    directAnswer: parsed.directAnswer?.trim() || '',
    missingInformation: '',
    explanation: parsed.explanation?.trim() || '',
    calculationSteps: (parsed.calculationSteps ?? []).map((step, i) => ({
      stepNumber: step.stepNumber || i + 1,
      title: step.title,
      expression: step.expression?.trim() || undefined,
      detail: step.detail,
    })),
    citations: (parsed.citations ?? []).map((c) => {
      const matchedDoc = params.documents.find(
        (d) => d.name.toLowerCase() === c.documentName.toLowerCase()
      );
      return {
        documentId: matchedDoc?.id,
        documentName: matchedDoc?.name ?? c.documentName,
        pageOrSection: c.pageOrSection,
        supportingPassage: c.supportingPassage,
      };
    }),
    checkedDocuments: params.documents.map((d) => d.name),
  };
}

export async function generateQuizFromDocuments(params: {
  documents: ServerDocumentContext[];
  questionCount: number;
  difficulty: 'foundational' | 'standard' | 'challenging';
  topicFocus?: string;
}) {
  const ai = getGeminiClient();
  const contextText = buildDocumentContextBlock(params.documents);
  const count = Math.min(10, Math.max(2, Math.round(params.questionCount || 5)));

  const systemInstruction = `You are .Aai ("The teacher, understand you"), creating a high-quality practice quiz strictly grounded in the student's selected documents.

RULES:
1. Every question, option, answer, explanation, and calculation MUST come strictly from the provided document content. Do not invent facts outside the documents.
2. Create exactly ${count} well-crafted questions at the "${params.difficulty}" difficulty level${
    params.topicFocus?.trim() ? `, focusing specifically on: "${params.topicFocus.trim()}"` : ''
  }.
3. Provide exactly 4 clear answer choices ("options") per question with 1 unambiguously correct choice ("correctOptionIndex" from 0 to 3).
4. If the documents contain quantitative formulas or numerical examples, include numerical problem questions ("type": "numerical") with ordered "calculationSteps". Otherwise use "type": "multiple-choice" with an empty "calculationSteps" array.
5. Every question MUST include an exact "citation" with "documentName", "pageOrSection", and a verbatim "supportingPassage" from the source material.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: `Selected Study Documents:\n${contextText}\n\nGenerate the ${count}-question ${params.difficulty} practice quiz.`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'Concise topic title for the quiz.' },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                type: {
                  type: Type.STRING,
                  description: 'Either "multiple-choice" or "numerical".',
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctOptionIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
                calculationSteps: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      stepNumber: { type: Type.INTEGER },
                      title: { type: Type.STRING },
                      expression: { type: Type.STRING },
                      detail: { type: Type.STRING },
                    },
                    required: ['stepNumber', 'title', 'detail'],
                  },
                },
                citation: {
                  type: Type.OBJECT,
                  properties: {
                    documentName: { type: Type.STRING },
                    pageOrSection: { type: Type.STRING },
                    supportingPassage: { type: Type.STRING },
                  },
                  required: ['documentName', 'pageOrSection', 'supportingPassage'],
                },
              },
              required: [
                'question',
                'type',
                'options',
                'correctOptionIndex',
                'explanation',
                'calculationSteps',
                'citation',
              ],
            },
          },
        },
        required: ['title', 'questions'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    title?: string;
    questions?: Array<{
      question: string;
      type: string;
      options: string[];
      correctOptionIndex: number;
      explanation: string;
      calculationSteps?: Array<{
        stepNumber: number;
        title: string;
        expression?: string;
        detail: string;
      }>;
      citation: {
        documentName: string;
        pageOrSection: string;
        supportingPassage: string;
      };
    }>;
  };

  const questions = (parsed.questions ?? []).map((q, idx) => {
    const safeOptions = (q.options ?? []).slice(0, 4);
    const safeCorrectIndex =
      q.correctOptionIndex >= 0 && q.correctOptionIndex < safeOptions.length
        ? q.correctOptionIndex
        : 0;
    const matchedDoc = params.documents.find(
      (d) => d.name.toLowerCase() === q.citation.documentName.toLowerCase()
    );

    return {
      id: `q_${idx + 1}_${Date.now()}`,
      question: q.question,
      type: q.type === 'numerical' ? ('numerical' as const) : ('multiple-choice' as const),
      options: safeOptions,
      correctOptionIndex: safeCorrectIndex,
      explanation: q.explanation,
      calculationSteps: (q.calculationSteps ?? []).map((s, sIdx) => ({
        stepNumber: s.stepNumber || sIdx + 1,
        title: s.title,
        expression: s.expression?.trim() || undefined,
        detail: s.detail,
      })),
      citation: {
        documentId: matchedDoc?.id,
        documentName: matchedDoc?.name ?? q.citation.documentName,
        pageOrSection: q.citation.pageOrSection,
        supportingPassage: q.citation.supportingPassage,
      },
    };
  });

  if (questions.length === 0) {
    throw new Error(
      'Could not generate quiz questions from the selected documents. Try selecting documents with more text content.'
    );
  }

  return {
    title: parsed.title?.trim() || 'Document Practice Quiz',
    difficulty: params.difficulty,
    sourceDocumentNames: params.documents.map((d) => d.name),
    questions,
  };
}
