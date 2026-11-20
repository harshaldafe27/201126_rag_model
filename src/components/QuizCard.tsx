import {
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type { GeneratedQuiz } from '../types';
import { CitationPanel } from './CitationPanel';

interface QuizCardProps {
  quiz: GeneratedQuiz;
  onSelectAnswer: (questionId: string, optionIndex: number) => void;
  onSubmitQuiz: () => void;
  onRetakeQuiz: () => void;
  onOpenDocument?: (documentId: string) => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export function QuizCard({
  quiz,
  onSelectAnswer,
  onSubmitQuiz,
  onRetakeQuiz,
  onOpenDocument,
}: QuizCardProps) {
  const totalCount = quiz.questions.length;
  const answeredCount = quiz.questions.filter(
    (q) => typeof quiz.selectedAnswers[q.id] === 'number'
  ).length;
  const correctCount = quiz.questions.filter(
    (q) => quiz.selectedAnswers[q.id] === q.correctOptionIndex
  ).length;
  const scorePercent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  const difficultyLabel =
    quiz.difficulty.charAt(0).toUpperCase() + quiz.difficulty.slice(1);

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Practice Quiz</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
            {quiz.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <span>{difficultyLabel}</span>
            <span aria-hidden="true"> · </span>
            <span>{totalCount} questions</span>
            <span aria-hidden="true"> · </span>
            <span>Sources: {quiz.sourceDocumentNames.join(', ')}</span>
          </p>
        </div>

        {quiz.submitted ? (
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="font-mono text-lg font-semibold text-slate-900 dark:text-slate-50 tabular-nums">
                {correctCount}/{totalCount}{' '}
                <span className="text-sm text-slate-500 dark:text-slate-400">({scorePercent}%)</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Quiz Score</p>
            </div>
            <button
              type="button"
              onClick={onRetakeQuiz}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retake</span>
            </button>
          </div>
        ) : (
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
            {answeredCount} of {totalCount} answered
          </span>
        )}
      </div>

      {/* Questions list */}
      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {quiz.questions.map((q, qIdx) => {
          const selected = quiz.selectedAnswers[q.id];
          const isCorrect = quiz.submitted && selected === q.correctOptionIndex;

          return (
            <div key={q.id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    Question {qIdx + 1} of {totalCount}
                    {q.type === 'numerical' ? ' · Numerical' : ''}
                  </p>
                  <p className="text-sm font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                    {q.question}
                  </p>
                </div>

                {quiz.submitted && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                      isCorrect
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {isCorrect ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>Correct</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        <span>Incorrect</span>
                      </>
                    )}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {q.options.map((option, optIdx) => {
                  const isChosen = selected === optIdx;
                  const isRightOption = optIdx === q.correctOptionIndex;

                  let buttonClasses =
                    'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50';

                  if (quiz.submitted) {
                    if (isRightOption) {
                      buttonClasses =
                        'border-emerald-500 bg-emerald-50/70 dark:border-emerald-600 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100';
                    } else if (isChosen && !isRightOption) {
                      buttonClasses =
                        'border-red-400 bg-red-50/70 dark:border-red-700 dark:bg-red-950/40 text-red-950 dark:text-red-100';
                    } else {
                      buttonClasses =
                        'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 text-slate-500 dark:text-slate-500';
                    }
                  } else if (isChosen) {
                    buttonClasses =
                      'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/50 text-blue-950 dark:text-blue-100';
                  }

                  return (
                    <button
                      key={`${q.id}-opt-${optIdx}`}
                      type="button"
                      disabled={quiz.submitted}
                      onClick={() => onSelectAnswer(q.id, optIdx)}
                      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left text-xs sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-default ${buttonClasses}`}
                    >
                      <span className="font-mono text-xs font-semibold opacity-80 shrink-0 mt-0.5">
                        {OPTION_LETTERS[optIdx] ?? optIdx + 1}.
                      </span>
                      <span className="leading-snug">{option}</span>
                    </button>
                  );
                })}
              </div>

              {/* Post-submission explanation, calculation steps & citation */}
              {quiz.submitted && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Explanation
                    </p>
                    <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {q.explanation}
                    </p>
                  </div>

                  {q.calculationSteps && q.calculationSteps.length > 0 && (
                    <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <Calculator className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Calculation Steps</span>
                      </div>
                      <ol className="space-y-1.5">
                        {q.calculationSteps.map((step) => (
                          <li key={step.stepNumber} className="text-xs text-slate-600 dark:text-slate-400">
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {step.stepNumber}. {step.title}:
                            </span>{' '}
                            {step.expression && (
                              <code className="mx-1 rounded bg-white dark:bg-slate-900 px-1.5 py-0.5 font-mono text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800">
                                {step.expression}
                              </code>
                            )}
                            <span>{step.detail}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <CitationPanel
                    citations={[q.citation]}
                    title="Question Source"
                    onOpenDocument={onOpenDocument}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer submit bar */}
      {!quiz.submitted && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 px-5 py-3.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {answeredCount < totalCount
              ? `Answer all ${totalCount} questions to check your score and view citations.`
              : 'All questions answered. Ready to submit for grading and explanations.'}
          </p>
          <button
            type="button"
            disabled={answeredCount === 0}
            onClick={onSubmitQuiz}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          >
            Submit Quiz
          </button>
        </div>
      )}
    </article>
  );
}
