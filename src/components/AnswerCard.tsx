import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  GraduationCap,
  ShieldCheck,
} from 'lucide-react';
import type { StructuredTutorAnswer } from '../types';
import { CitationPanel } from './CitationPanel';

interface AnswerCardProps {
  answer: StructuredTutorAnswer;
  createdAt?: string;
  onOpenDocument?: (documentId: string) => void;
}

export function AnswerCard({ answer, onOpenDocument }: AnswerCardProps) {
  if (!answer.isSupported) {
    return (
      <article className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Insufficient Evidence in Selected Documents
              </p>
              {typeof answer.retrievedChunkCount === 'number' && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {answer.retrievedChunkCount} matching{' '}
                  {answer.retrievedChunkCount === 1 ? 'chunk' : 'chunks'}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-base font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {answer.directAnswer}
            </h3>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2.5">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              What information is missing
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {answer.missingInformation ||
                'The selected documents do not contain details required to verify and answer this question.'}
            </p>
          </div>

          {answer.explanation && (
            <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {answer.explanation}
              </p>
            </div>
          )}
        </div>

        {answer.checkedDocuments && answer.checkedDocuments.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Searched documents: {answer.checkedDocuments.join(' · ')}
          </p>
        )}
      </article>
    );
  }

  const evidenceLabel =
    answer.evidenceStatus === 'moderate' ? 'Moderate evidence' : 'Strong evidence';
  const evidenceColor =
    answer.evidenceStatus === 'moderate'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-emerald-700 dark:text-emerald-400';

  const numerical = answer.numericalSolution;
  const fallbackSteps = !numerical && answer.calculationSteps?.length > 0 ? answer.calculationSteps : [];

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
      {/* Direct Answer header + RAG Evidence Status */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <GraduationCap className="h-4 w-4" aria-hidden="true" />
            <span>Direct Answer</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
            <span className={`inline-flex items-center gap-1 font-medium ${evidenceColor}`}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{evidenceLabel}</span>
            </span>
            {typeof answer.confidenceScore === 'number' && (
              <>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  ·
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {answer.confidenceScore}% confidence
                </span>
              </>
            )}
          </div>
        </div>

        <p className="text-base font-semibold leading-relaxed text-slate-900 dark:text-slate-50">
          {answer.directAnswer}
        </p>
      </div>

      {/* Explanation */}
      {answer.explanation && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">Explanation</h4>
          <p className="text-sm leading-7 text-slate-700 dark:text-slate-300 whitespace-pre-line">
            {answer.explanation}
          </p>
        </div>
      )}

      {/* Structured Numerical Solution (Formula, Inputs, Verified Steps, Final Answer, Source Link) */}
      {numerical && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Calculator className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Step-by-Step Numerical Solution</span>
            </div>

            {numerical.verifiedProgrammatically && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Programmatically verified</span>
              </span>
            )}
          </div>

          {/* Formula & Input Values */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {numerical.formula && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Formula
                </p>
                <p className="mt-1 font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                  {numerical.formula}
                </p>
              </div>
            )}

            {numerical.inputValues && numerical.inputValues.length > 0 && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Input Values
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                  {numerical.inputValues.map((input, idx) => (
                    <li key={`${input.symbol}-${idx}`}>
                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                        {input.symbol}
                      </span>{' '}
                      = {input.value}
                      {input.unit ? ` ${input.unit}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Ordered Steps */}
          <ol className="space-y-2.5">
            {numerical.steps.map((step) => (
              <li
                key={step.stepNumber}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5"
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums shrink-0">
                    Step {step.stepNumber}.
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {step.title}
                      </p>
                      {step.verified === true && (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>Checked</span>
                        </span>
                      )}
                    </div>
                    {step.expression && (
                      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100 tabular-nums">
                        {step.expression}
                      </div>
                    )}
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {step.detail}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* Final Computed Answer & Source Provenance */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                Final Calculated Answer
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-50 tabular-nums">
                {numerical.finalAnswer}
              </p>
            </div>
            {numerical.sourceReference && (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Source: <span className="font-mono">{numerical.sourceReference}</span>
              </p>
            )}
          </div>
          {numerical.verificationNote && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {numerical.verificationNote}
            </p>
          )}
        </div>
      )}

      {/* Backwards-compatible fallback calculation steps */}
      {fallbackSteps.length > 0 && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <Calculator className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Step-by-Step Calculation</span>
          </div>
          <ol className="space-y-2.5">
            {fallbackSteps.map((step) => (
              <li
                key={step.stepNumber}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3.5"
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 tabular-nums shrink-0">
                    Step {step.stepNumber}.
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {step.title}
                    </p>
                    {step.expression && (
                      <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100 tabular-nums">
                        {step.expression}
                      </div>
                    )}
                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {step.detail}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Expandable Validated Citations */}
      <CitationPanel
        citations={answer.citations}
        defaultExpanded={answer.citations.length === 1}
        onOpenDocument={onOpenDocument}
      />
    </article>
  );
}
