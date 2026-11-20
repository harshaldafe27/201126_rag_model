import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000';
const WS_A = `ws_qa_alpha_${Date.now()}`;
const WS_B = `ws_qa_beta_${Date.now()}`;
const DATA_DIR = path.resolve(process.cwd(), process.env.RAG_DATA_DIR || '.aai-data');
const UNSUPPORTED_TEXT =
  'Insufficient information in your uploaded documents to answer this question.';

interface TestRecord {
  section: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details: string;
}

const results: TestRecord[] = [];
const ragLatenciesMs: number[] = [];
const citationChecks: Array<{ valid: boolean; relevance?: number }> = [];
let factualPassed = 0;
let factualTotal = 0;
let numericalPassed = 0;
let numericalTotal = 0;
let refusalPassed = 0;
let refusalTotal = 0;
let multiDocPassed = 0;

async function runTest(section: string, name: string, fn: () => Promise<string | void>) {
  const start = performance.now();
  try {
    const details = (await fn()) || 'Passed';
    const durationMs = Math.round(performance.now() - start);
    results.push({ section, name, passed: true, durationMs, details });
    console.log(`  [PASS] (${durationMs}ms) ${name} — ${details}`);
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const details = err instanceof Error ? err.message : String(err);
    results.push({ section, name, passed: false, durationMs, details });
    console.error(`  [FAIL] (${durationMs}ms) ${name} — ${details}`);
  }
}

// ---------- Authentic Multi-Format Document Builders ----------

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMultiPagePdf(pages: string[][]): Buffer {
  // Build valid PDF 1.4 with proper object offsets & xref table
  const objects: string[] = [];
  const pageObjNumbers: number[] = [];

  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Font
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(''); // placeholder for Pages
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  for (const lines of pages) {
    const contentStream = [
      'BT',
      '/F1 12 Tf',
      '50 750 Td',
      '16 TL',
      ...lines.map((line, i) => (i === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`)),
      'ET',
    ].join('\n');

    const contentObjNum = objects.length + 1;
    objects.push(
      `<< /Length ${Buffer.byteLength(contentStream, 'latin1')} >>\nstream\n${contentStream}\nendstream`
    );

    const pageObjNum = objects.length + 1;
    pageObjNumbers.push(pageObjNum);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>`
    );
  }

  objects[1] = `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNumbers.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

async function buildDocxBuffer(
  sections: Array<{ heading: string; paragraphs: string[] }>
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  const xmlEscape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const bodyXml = sections
    .map((sec) => {
      const h = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEscape(sec.heading)}</w:t></w:r></w:p>`;
      const ps = sec.paragraphs
        .map((p) => `<w:p><w:r><w:t>${xmlEscape(p)}</w:t></w:r></w:p>`)
        .join('');
      return h + ps;
    })
    .join('');

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildPptxBuffer(
  slides: Array<{ title: string; bullets: string[]; notes?: string }>
): Promise<Buffer> {
  const zip = new JSZip();
  const xmlEscape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>`
  );

  slides.forEach((slide, idx) => {
    const num = idx + 1;
    const paragraphs = [slide.title, ...slide.bullets]
      .map((line) => `<a:p><a:r><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
      .join('');

    zip.file(
      `ppt/slides/slide${num}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    );

    if (slide.notes) {
      zip.file(
        `ppt/notesSlides/notesSlide${num}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xmlEscape(slide.notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`
      );
    }
  });

  return zip.generateAsync({ type: 'nodebuffer' });
}

function buildRtfDocBuffer(title: string, paragraphs: string[]): Buffer {
  const body = [title, ...paragraphs].map((p) => `${p}\\par`).join('\n');
  return Buffer.from(`{\\rtf1\\ansi\\deff0\n${body}\n}`, 'latin1');
}

function buildBinaryPptBuffer(slideTexts: string[]): Buffer {
  // OLE2 signature + PowerPoint TextCharsAtom (0x0FA0) records
  const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const parts: Buffer[] = [oleHeader, Buffer.alloc(64, 0)];

  for (const text of slideTexts) {
    const encoded = Buffer.from(text, 'utf16le');
    const recHeader = Buffer.alloc(8);
    recHeader.writeUInt16LE(0x0000, 0); // ver=0, inst=0
    recHeader.writeUInt16LE(0x0fa0, 2); // TextCharsAtom
    recHeader.writeUInt32LE(encoded.length, 4);
    parts.push(recHeader, encoded);
  }

  return Buffer.concat(parts);
}

// ---------- HTTP Helpers ----------

async function uploadFile(params: {
  workspaceId?: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  duplicateStrategy?: 'prompt' | 'reindex';
}) {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.buffer)], { type: params.mimeType });
  form.append('file', blob, params.fileName);
  if (params.duplicateStrategy) {
    form.append('duplicateStrategy', params.duplicateStrategy);
  }

  const headers: Record<string, string> = {};
  if (params.workspaceId !== undefined) {
    headers['X-Workspace-Id'] = params.workspaceId;
  }

  const res = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

async function askRag(params: {
  workspaceId?: string;
  question: string;
  documentIds: string[];
}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.workspaceId !== undefined) {
    headers['X-Workspace-Id'] = params.workspaceId;
  }

  const start = performance.now();
  const res = await fetch(`${BASE_URL}/api/rag/ask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      question: params.question,
      documentIds: params.documentIds,
      history: [],
    }),
  });
  const latencyMs = Math.round(performance.now() - start);
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data, latencyMs };
}

// ---------- Main QA Suite Execution ----------

async function main() {
  console.log(`\nRunning .Aai End-to-End RAG QA Suite against ${BASE_URL}`);
  console.log(`Workspace A: ${WS_A} | Workspace B: ${WS_B}\n`);

  // Prepare realistic teacher-approved sample chapters
  const pdfBuffer = buildMultiPagePdf([
    [
      'Chapter 4: Classical Mechanics and Dynamics',
      'Section 4.1: Newtons Second Law of Motion',
      'Newtons Second Law states that the net force acting on an object equals its mass multiplied by its acceleration.',
      'Formula: F = m * a, where F is net force in Newtons (N), m is mass in kilograms (kg), and a is acceleration in m/s^2.',
      'The SI unit of force is the Newton (N), defined as 1 kg*m/s^2.',
    ],
    [
      'Section 4.2: Kinetic Energy and Work-Energy Theorem',
      'Kinetic energy is the energy an object possesses due to its motion.',
      'The formula for translational kinetic energy is KE = 0.5 * m * v^2, where m is mass in kilograms (kg) and v is velocity in meters per second (m/s).',
      'Kinetic energy is measured in Joules (J). Doubling the velocity of a moving object quadruples its kinetic energy.',
    ],
    [
      'Section 4.3: Gravitational Potential Energy',
      'Gravitational potential energy depends on an objects mass, height above a reference point, and gravitational acceleration.',
      'Formula: PE = m * g * h, where g = 9.8 m/s^2 on Earths surface, m is mass in kg, and h is height in meters.',
      'In a closed frictionless system, total mechanical energy (KE + PE) remains conserved.',
    ],
  ]);

  const docxBuffer = await buildDocxBuffer([
    {
      heading: 'Section 1: Ideal Gas Law',
      paragraphs: [
        'The Ideal Gas Law relates pressure, volume, amount of gas, and absolute temperature via PV = nRT.',
        'The universal gas constant R is equal to 8.314 J/(mol*K). Temperature T must always be expressed in Kelvin.',
      ],
    },
    {
      heading: 'Section 2: Specific Heat Capacity',
      paragraphs: [
        'The heat energy Q required to change the temperature of a substance is given by the formula Q = m * c * deltaT.',
        'Here m is mass in grams, c is specific heat capacity in J/(g*C), and deltaT is temperature change in degrees Celsius.',
        'For pure liquid water, the specific heat capacity is c = 4.186 J/(g*C).',
      ],
    },
  ]);

  const pptxBuffer = await buildPptxBuffer([
    {
      title: 'Cellular Respiration and Mitochondria',
      bullets: [
        'Mitochondria generate most of the cells supply of adenosine triphosphate (ATP) through oxidative phosphorylation.',
        'The inner mitochondrial membrane folds into cristae to maximize surface area for the electron transport chain.',
      ],
      notes: 'Emphasize that cristae house ATP synthase complexes.',
    },
    {
      title: 'Chloroplasts and the Calvin Cycle',
      bullets: [
        'Light-dependent reactions take place in the thylakoid membranes of chloroplasts.',
        'The Calvin Cycle (carbon fixation) takes place in the stroma of chloroplasts and uses ATP and NADPH to produce glucose precursors.',
      ],
    },
  ]);

  const docBuffer = buildRtfDocBuffer('Chapter 7: Acids and Bases', [
    'Acids are proton donors according to the Bronsted-Lowry definition, while bases are proton acceptors.',
    'Neutral pure water at 25 degrees Celsius has a pH of 7.0.',
  ]);

  const pptBuffer = buildBinaryPptBuffer([
    'Optics Lecture: Snells Law of Refraction',
    'Snells Law relates incident and refracted angles via n1 * sin(theta1) = n2 * sin(theta2).',
  ]);

  let pdfDocId = '';
  let docxDocId = '';
  let pptxDocId = '';
  let docDocId = '';
  let pptDocId = '';

  // =========================================================
  // 1. DOCUMENT UPLOAD & VALIDATION TESTING
  // =========================================================
  console.log('=== 1. Document Upload & Validation Testing ===');

  await runTest('1. Upload & Validation', 'Valid multi-page PDF upload & indexing', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Chapter_4_Classical_Mechanics.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.document.format, 'PDF');
    assert.equal(res.data.document.pageCount, 3);
    assert.equal(res.data.document.status, 'ready');
    assert.ok(res.data.document.chunkCount >= 3, 'Expected >= 3 indexed chunks');
    pdfDocId = res.data.document.id;
    return `docId=${pdfDocId}, pages=${res.data.document.pageCount}, chunks=${res.data.document.chunkCount}`;
  });

  await runTest('1. Upload & Validation', 'Valid DOCX upload & section indexing', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Thermodynamics_Notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.document.format, 'DOCX');
    assert.equal(res.data.document.status, 'ready');
    assert.ok(res.data.document.chunkCount >= 2);
    docxDocId = res.data.document.id;
    return `docId=${docxDocId}, sections=${res.data.document.pageCount}, chunks=${res.data.document.chunkCount}`;
  });

  await runTest('1. Upload & Validation', 'Valid PPTX upload & slide indexing', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Cell_Biology_Slides.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: pptxBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.document.format, 'PPTX');
    assert.equal(res.data.document.pageCount, 2);
    assert.equal(res.data.document.status, 'ready');
    pptxDocId = res.data.document.id;
    return `docId=${pptxDocId}, slides=${res.data.document.pageCount}, chunks=${res.data.document.chunkCount}`;
  });

  await runTest('1. Upload & Validation', 'Valid DOC upload & indexing', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Acids_and_Bases.doc',
      mimeType: 'application/msword',
      buffer: docBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.document.format, 'DOC');
    assert.equal(res.data.document.status, 'ready');
    docDocId = res.data.document.id;
    return `docId=${docDocId}, chunks=${res.data.document.chunkCount}`;
  });

  await runTest('1. Upload & Validation', 'Valid legacy PPT upload & indexing', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Optics_Basics.ppt',
      mimeType: 'application/vnd.ms-powerpoint',
      buffer: pptBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.document.format, 'PPT');
    assert.equal(res.data.document.status, 'ready');
    pptDocId = res.data.document.id;
    return `docId=${pptDocId}, chunks=${res.data.document.chunkCount}`;
  });

  await runTest('1. Upload & Validation', 'Reject invalid file format (.txt)', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Plain text file should be rejected'),
    });
    assert.equal(res.status, 400);
    assert.match(String(res.data.error), /unsupported file format/i);
    return `HTTP 400 — ${res.data.error}`;
  });

  await runTest('1. Upload & Validation', 'Reject file larger than 10 MB', async () => {
    const oversized = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(10 * 1024 * 1024 + 128 * 1024, 0x41),
    ]);
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Huge_Textbook.pdf',
      mimeType: 'application/pdf',
      buffer: oversized,
    });
    assert.equal(res.status, 413);
    assert.match(String(res.data.error), /10 MB/i);
    return `HTTP 413 — ${res.data.error}`;
  });

  await runTest('1. Upload & Validation', 'Reject corrupted PDF (fake header)', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Corrupted_File.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('THIS_IS_NOT_A_VALID_PDF_BINARY'),
    });
    assert.equal(res.status, 422);
    assert.match(String(res.data.error), /valid PDF/i);
    return `HTTP 422 — ${res.data.error}`;
  });

  await runTest('1. Upload & Validation', 'Reject corrupted DOCX (broken ZIP)', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Corrupted_Notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xff, 0xff]),
    });
    assert.equal(res.status, 422);
    return `HTTP 422 — ${res.data.error}`;
  });

  await runTest('1. Upload & Validation', 'Reject empty 0-byte document', async () => {
    const res = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Empty_File.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(0),
    });
    assert.ok(res.status === 400 || res.status === 422);
    assert.match(String(res.data.error), /empty/i);
    return `HTTP ${res.status} — ${res.data.error}`;
  });

  await runTest('1. Upload & Validation', 'Duplicate upload triggers 409 & Re-index succeeds', async () => {
    const dupRes = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Chapter_4_Copy.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
      duplicateStrategy: 'prompt',
    });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.data.duplicate, true);
    assert.equal(dupRes.data.existingDocument.id, pdfDocId);

    // Resolve by re-indexing
    const reindexRes = await uploadFile({
      workspaceId: WS_A,
      fileName: 'Chapter_4_Classical_Mechanics.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
      duplicateStrategy: 'reindex',
    });
    assert.equal(reindexRes.status, 201);
    assert.equal(reindexRes.data.document.id, pdfDocId);
    return `HTTP 409 detected duplicate -> re-indexed docId=${pdfDocId}`;
  });

  await runTest('1. Upload & Validation', 'Reject unauthorized upload (missing/malformed workspace)', async () => {
    const noHeader = await uploadFile({
      fileName: 'Chapter_4_Classical_Mechanics.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    assert.equal(noHeader.status, 401);

    const traversal = await uploadFile({
      workspaceId: '../escape_root',
      fileName: 'Chapter_4_Classical_Mechanics.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    assert.equal(traversal.status, 401);
    return 'HTTP 401 on missing and path-traversal workspace headers';
  });

  // =========================================================
  // 2. FACTUAL QUESTION TESTING
  // =========================================================
  console.log('\n=== 2. Factual Question Testing ===');

  const factualCases = [
    {
      name: 'Factual Q1 — Newtons Second Law & SI unit (PDF Page 1)',
      question:
        "What does Newton's Second Law state and what is the SI unit of force according to the chapter?",
      docIds: [pdfDocId],
      expectTerms: ['mass', 'acceleration', 'newton'],
      expectedDoc: 'Chapter_4_Classical_Mechanics.pdf',
      expectedPage: 'Page 1',
    },
    {
      name: 'Factual Q2 — Calvin Cycle location (PPTX Slide 2)',
      question: 'Where does the Calvin Cycle take place inside chloroplasts?',
      docIds: [pptxDocId],
      expectTerms: ['stroma'],
      expectedDoc: 'Cell_Biology_Slides.pptx',
      expectedPage: 'Slide 2',
    },
    {
      name: 'Factual Q3 — Universal gas constant R (DOCX Section 1)',
      question: 'What value is given for the universal gas constant R in the thermodynamics notes?',
      docIds: [docxDocId],
      expectTerms: ['8.314'],
      expectedDoc: 'Thermodynamics_Notes.docx',
      expectedPage: 'Section 1',
    },
  ];

  for (const tc of factualCases) {
    factualTotal += 1;
    await runTest('2. Factual Q&A', tc.name, async () => {
      const { status, data, latencyMs } = await askRag({
        workspaceId: WS_A,
        question: tc.question,
        documentIds: tc.docIds,
      });
      ragLatenciesMs.push(latencyMs);
      assert.equal(status, 200, `HTTP ${status}: ${JSON.stringify(data)}`);
      const ans = data.answer;
      assert.equal(ans.isSupported, true, `Expected supported answer, got: ${ans.directAnswer}`);
      const combined = `${ans.directAnswer} ${ans.explanation}`.toLowerCase();
      for (const term of tc.expectTerms) {
        assert.ok(combined.includes(term), `Expected answer to include "${term}", got: ${combined}`);
      }
      assert.ok(ans.citations.length >= 1, 'Expected at least 1 verified citation');
      const primaryCitation = ans.citations[0];
      const citValid =
        primaryCitation.verified === true &&
        primaryCitation.documentName === tc.expectedDoc &&
        primaryCitation.pageOrSection.includes(tc.expectedPage);
      citationChecks.push({ valid: citValid, relevance: primaryCitation.relevanceScore });
      assert.ok(
        citValid,
        `Citation mismatch: expected ${tc.expectedDoc} (${tc.expectedPage}), got ${primaryCitation.documentName} (${primaryCitation.pageOrSection})`
      );
      factualPassed += 1;
      return `${latencyMs}ms | ${ans.evidenceStatus} (${ans.confidenceScore}%) | Cited ${primaryCitation.documentName} · ${primaryCitation.pageOrSection}`;
    });
  }

  // =========================================================
  // 3. NUMERICAL QUESTION TESTING
  // =========================================================
  console.log('\n=== 3. Numerical Question Testing ===');

  const numericalCases = [
    {
      name: 'Numerical Q1 — Kinetic Energy (m=4 kg, v=6 m/s => 72 J)',
      question:
        'A 4 kg object moves at a velocity of 6 m/s. Using the kinetic energy formula in the chapter, calculate its kinetic energy.',
      docIds: [pdfDocId],
      expectedNumber: '72',
      expectedDoc: 'Chapter_4_Classical_Mechanics.pdf',
      expectedPage: 'Page 2',
    },
    {
      name: 'Numerical Q2 — Gravitational Potential Energy (m=10 kg, h=5 m => 490 J)',
      question:
        'Calculate the gravitational potential energy of a 10 kg mass lifted to a height of 5 meters using g from the chapter.',
      docIds: [pdfDocId],
      expectedNumber: '490',
      expectedDoc: 'Chapter_4_Classical_Mechanics.pdf',
      expectedPage: 'Page 3',
    },
    {
      name: 'Numerical Q3 — Heat Energy Q (m=100 g water, deltaT=10 C => 4186 J)',
      question:
        'How much heat energy Q is required to raise the temperature of 100 grams of liquid water by 10 degrees Celsius using the specific heat capacity in the notes?',
      docIds: [docxDocId],
      expectedNumber: '4186',
      expectedDoc: 'Thermodynamics_Notes.docx',
      expectedPage: 'Section 2',
    },
  ];

  for (const tc of numericalCases) {
    numericalTotal += 1;
    await runTest('3. Numerical Q&A', tc.name, async () => {
      const { status, data, latencyMs } = await askRag({
        workspaceId: WS_A,
        question: tc.question,
        documentIds: tc.docIds,
      });
      ragLatenciesMs.push(latencyMs);
      assert.equal(status, 200, `HTTP ${status}: ${JSON.stringify(data)}`);
      const ans = data.answer;
      assert.equal(ans.isSupported, true);
      assert.ok(ans.numericalSolution, 'Expected structured numericalSolution object');
      assert.ok(ans.numericalSolution.formula.length > 0, 'Expected formula');
      assert.ok(ans.numericalSolution.inputValues.length >= 2, 'Expected inputValues');
      assert.ok(ans.numericalSolution.steps.length >= 1, 'Expected calculation steps');

      const finalBlob = `${ans.directAnswer} ${ans.numericalSolution.finalAnswer}`.replace(/,/g, '');
      assert.ok(
        finalBlob.includes(tc.expectedNumber),
        `Expected final answer to contain ${tc.expectedNumber}, got: ${finalBlob}`
      );
      assert.equal(
        ans.numericalSolution.verifiedProgrammatically,
        true,
        `Expected programmatic math verification to pass (${ans.numericalSolution.verificationNote})`
      );

      assert.ok(ans.citations.length >= 1);
      const cit = ans.citations[0];
      const citValid =
        cit.verified === true &&
        cit.documentName === tc.expectedDoc &&
        cit.pageOrSection.includes(tc.expectedPage);
      citationChecks.push({ valid: citValid, relevance: cit.relevanceScore });
      assert.ok(
        citValid,
        `Citation mismatch: expected ${tc.expectedDoc} (${tc.expectedPage}), got ${cit.documentName} (${cit.pageOrSection})`
      );
      numericalPassed += 1;
      return `${latencyMs}ms | Final=${ans.numericalSolution.finalAnswer} | MathVerified=true | Cited ${cit.pageOrSection}`;
    });
  }

  // =========================================================
  // 4. UNSUPPORTED QUESTION TESTING
  // =========================================================
  console.log('\n=== 4. Unsupported Question Testing ===');

  const unsupportedCases = [
    {
      name: 'Unsupported Q1 — World Cup history (absent from physics/bio docs)',
      question: 'Who won the 1998 FIFA World Cup and what was the final score?',
    },
    {
      name: 'Unsupported Q2 — Liquid mercury boiling point (absent)',
      question: 'What is the exact boiling point of liquid mercury in Kelvin?',
    },
    {
      name: 'Unsupported Q3 — French Revolution causes (absent)',
      question: 'What were the three primary causes of the French Revolution in 1789?',
    },
  ];

  for (const tc of unsupportedCases) {
    refusalTotal += 1;
    await runTest('4. Unsupported Detection', tc.name, async () => {
      const { status, data, latencyMs } = await askRag({
        workspaceId: WS_A,
        question: tc.question,
        documentIds: [pdfDocId, docxDocId, pptxDocId],
      });
      ragLatenciesMs.push(latencyMs);
      assert.equal(status, 200);
      const ans = data.answer;
      assert.equal(ans.isSupported, false, `Should refuse unsupported question, got: ${ans.directAnswer}`);
      assert.equal(ans.evidenceStatus, 'insufficient');
      assert.equal(ans.directAnswer, UNSUPPORTED_TEXT);
      assert.ok(ans.missingInformation && ans.missingInformation.length > 15, 'Must explain missing info');
      assert.equal(ans.citations.length, 0, 'Must never fabricate citations for unsupported questions');
      refusalPassed += 1;
      return `${latencyMs}ms | Refused cleanly | 0 fabricated citations`;
    });
  }

  // =========================================================
  // 5. MULTI-DOCUMENT RETRIEVAL & QUIZ GENERATION
  // =========================================================
  console.log('\n=== 5. Multi-Document Retrieval & Quiz Testing ===');

  await runTest(
    '5. RAG Performance',
    'Multi-document synthesis across PDF + DOCX simultaneously',
    async () => {
      const { status, data, latencyMs } = await askRag({
        workspaceId: WS_A,
        question:
          'Compare the kinetic energy formula from the classical mechanics chapter with the heat energy formula Q from the thermodynamics notes.',
        documentIds: [pdfDocId, docxDocId, pptxDocId],
      });
      ragLatenciesMs.push(latencyMs);
      assert.equal(status, 200);
      const ans = data.answer;
      assert.equal(ans.isSupported, true);
      const citedDocs = new Set(ans.citations.map((c: any) => c.documentName));
      assert.ok(
        citedDocs.has('Chapter_4_Classical_Mechanics.pdf') &&
          citedDocs.has('Thermodynamics_Notes.docx'),
        `Expected citations from both PDF and DOCX, got: ${Array.from(citedDocs).join(', ')}`
      );
      ans.citations.forEach((c: any) =>
        citationChecks.push({ valid: c.verified === true, relevance: c.relevanceScore })
      );
      multiDocPassed = 1;
      return `${latencyMs}ms | Cited both documents (${ans.citations.length} verified citations)`;
    }
  );

  await runTest('5. RAG Performance', 'On-demand RAG Quiz generation with verified citations', async () => {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/api/rag/quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': WS_A,
      },
      body: JSON.stringify({
        documentIds: [pdfDocId, pptxDocId],
        questionCount: 3,
        difficulty: 'standard',
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    const data = (await res.json()) as Record<string, any>;
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.equal(data.quiz.questions.length, 3);
    for (const q of data.quiz.questions) {
      assert.equal(q.options.length, 4);
      assert.ok(q.correctOptionIndex >= 0 && q.correctOptionIndex <= 3);
      assert.equal(q.citation.verified, true);
    }
    return `${latencyMs}ms | Generated 3 grounded quiz questions with verified chunk citations`;
  });

  // =========================================================
  // 6. SECURITY, ISOLATION, PERSISTENCE, RE-INDEX & CLEANUP
  // =========================================================
  console.log('\n=== 6. Security, Persistence, Re-indexing & Integration Testing ===');

  await runTest('6. Security & Integration', 'Workspace-specific document & vector isolation', async () => {
    const listB = await fetch(`${BASE_URL}/api/documents`, {
      headers: { 'X-Workspace-Id': WS_B },
    });
    const listBData = (await listB.json()) as { documents: any[] };
    assert.equal(listBData.documents.length, 0, 'Workspace B must not see Workspace A documents');

    const fileB = await fetch(`${BASE_URL}/api/documents/${pdfDocId}/file?workspaceId=${WS_B}`);
    assert.equal(fileB.status, 404, 'Workspace B must not download Workspace A file');

    const askB = await askRag({
      workspaceId: WS_B,
      question: "What is Newton's Second Law?",
      documentIds: [pdfDocId],
    });
    assert.ok(askB.status >= 400, 'Workspace B must not query Workspace A vectors');
    return 'Workspace B blocked from listing, downloading, and querying Workspace A';
  });

  await runTest('6. Security & Integration', 'Persistent vector store & file storage on disk', async () => {
    const wsDir = path.join(DATA_DIR, 'workspaces', WS_A);
    const docsRaw = await fs.readFile(path.join(wsDir, 'documents.json'), 'utf-8');
    const vecsRaw = await fs.readFile(path.join(wsDir, 'vectors.json'), 'utf-8');
    const docs = JSON.parse(docsRaw) as any[];
    const vecs = JSON.parse(vecsRaw) as any[];
    assert.equal(docs.length, 5, `Expected 5 persisted documents, found ${docs.length}`);
    assert.ok(vecs.length >= 7, `Expected >= 7 persisted vector chunks, found ${vecs.length}`);
    assert.ok(vecs[0].embedding.length > 100, 'Expected real high-dimensional Gemini embeddings');
    return `${docs.length} docs, ${vecs.length} vectors (dim=${vecs[0].embedding.length}) persisted on disk`;
  });

  await runTest('6. Security & Integration', 'Document re-indexing rebuilds chunks & timestamps', async () => {
    const res = await fetch(`${BASE_URL}/api/documents/${pdfDocId}/reindex`, {
      method: 'POST',
      headers: { 'X-Workspace-Id': WS_A },
    });
    const data = (await res.json()) as Record<string, any>;
    assert.equal(res.status, 200);
    assert.equal(data.document.status, 'ready');
    assert.ok(data.document.lastIndexedAt);
    return `Re-indexed ${data.document.name} (${data.document.chunkCount} chunks)`;
  });

  await runTest('6. Security & Integration', 'Document deletion cleans up metadata, file & vectors', async () => {
    const delRes = await fetch(`${BASE_URL}/api/documents/${pdfDocId}`, {
      method: 'DELETE',
      headers: { 'X-Workspace-Id': WS_A },
    });
    const delData = (await delRes.json()) as { deleted: boolean; removedChunks: number };
    assert.equal(delRes.status, 200);
    assert.equal(delData.deleted, true);
    assert.ok(delData.removedChunks >= 3, 'Expected vector chunks to be deleted');

    const vecsRaw = await fs.readFile(
      path.join(DATA_DIR, 'workspaces', WS_A, 'vectors.json'),
      'utf-8'
    );
    const vecs = JSON.parse(vecsRaw) as any[];
    const orphaned = vecs.filter((v) => v.documentId === pdfDocId);
    assert.equal(orphaned.length, 0, 'Zero orphaned vectors may remain after delete');

    const fileAfter = await fetch(`${BASE_URL}/api/documents/${pdfDocId}/file?workspaceId=${WS_A}`);
    assert.equal(fileAfter.status, 404);
    return `Deleted doc + ${delData.removedChunks} vectors; 0 orphaned records`;
  });

  await runTest('6. Security & Integration', 'Frontend SPA & API secret hygiene check', async () => {
    const htmlRes = await fetch(`${BASE_URL}/`);
    const html = await htmlRes.text();
    assert.equal(htmlRes.status, 200);
    assert.ok(html.includes('.Aai'), 'Expected .Aai title in served HTML');
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.length > 8) {
      assert.ok(!html.includes(apiKey), 'GEMINI_API_KEY must never appear in served HTML');
    }
    return 'Frontend HTML served (HTTP 200) with zero API key exposure';
  });

  // Clean up test workspaces cleanly
  await fs.rm(path.join(DATA_DIR, 'workspaces', WS_A), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(DATA_DIR, 'workspaces', WS_B), { recursive: true, force: true }).catch(() => {});

  // Compute quantitative metrics
  const totalTests = results.length;
  const passedTests = results.filter((r) => r.passed).length;
  const answerAccuracy = Math.round(
    ((factualPassed + numericalPassed + multiDocPassed) / (factualTotal + numericalTotal + 1)) * 100
  );
  const citationAccuracy =
    citationChecks.length > 0
      ? Math.round(
          (citationChecks.filter((c) => c.valid).length / citationChecks.length) * 100
        )
      : 0;
  const avgRelevance =
    citationChecks.length > 0
      ? Math.round(
          citationChecks.reduce((s, c) => s + (c.relevance ?? 0), 0) / citationChecks.length
        )
      : 0;
  const refusalAccuracy = Math.round((refusalPassed / Math.max(1, refusalTotal)) * 100);
  const avgLatencyMs =
    ragLatenciesMs.length > 0
      ? Math.round(ragLatenciesMs.reduce((a, b) => a + b, 0) / ragLatenciesMs.length)
      : 0;
  const minLatencyMs = ragLatenciesMs.length > 0 ? Math.min(...ragLatenciesMs) : 0;
  const maxLatencyMs = ragLatenciesMs.length > 0 ? Math.max(...ragLatenciesMs) : 0;

  const summary = {
    executedAt: new Date().toISOString(),
    totalTests,
    passedTests,
    failedTests: totalTests - passedTests,
    metrics: {
      answerAccuracyPct: answerAccuracy,
      citationAccuracyPct: citationAccuracy,
      retrievalAvgRelevancePct: avgRelevance,
      refusalAccuracyPct: refusalAccuracy,
      responseTimeMs: {
        min: minLatencyMs,
        avg: avgLatencyMs,
        max: maxLatencyMs,
      },
    },
    results,
  };

  await fs.writeFile('/tmp/aai_qa_results.json', JSON.stringify(summary, null, 2), 'utf-8');

  console.log('\n================ QA EVALUATION SUMMARY ================');
  console.log(`Tests Passed:        ${passedTests}/${totalTests}`);
  console.log(`Answer Accuracy:     ${answerAccuracy}%`);
  console.log(`Citation Accuracy:   ${citationAccuracy}%`);
  console.log(`Retrieval Quality:   ${avgRelevance}% avg semantic relevance`);
  console.log(`Refusal Accuracy:    ${refusalAccuracy}% (${refusalPassed}/${refusalTotal})`);
  console.log(`Response Latency:    avg ${avgLatencyMs}ms (min ${minLatencyMs}ms / max ${maxLatencyMs}ms)`);
  console.log('=======================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal QA suite error:', err);
  process.exit(1);
});
