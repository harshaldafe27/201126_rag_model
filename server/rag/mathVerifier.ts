import type { CalculationStep, NumericalSolution } from './types.ts';

// Safe recursive-descent arithmetic evaluator (zero eval / Function usage)
type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'fn'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: (x) => Math.log10(x),
  log10: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  exp: (x) => Math.exp(x),
  round: (x) => Math.round(x),
  pow: (a, b) => Math.pow(a, b),
};

function normalizeMathString(raw: string): string {
  return raw
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/−|–|—/g, '-')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .replace(/,/g, '')
    .replace(/\*\*/g, '^')
    .trim();
}

function stripPhysicalUnits(expr: string): string {
  let cleaned = normalizeMathString(expr);
  // Strip compound unit expressions like J/(g*°C), J/(g*C), J/(mol*K), kg*m/s^2, m/s^2, m/s
  cleaned = cleaned.replace(
    /(\d(?:\.\d+)?)\s*(?:k?J\s*\/\s*\([^)]+\)|kg\*m\/s\^2|m\/s\^2|m\/s|km\/h|mol\/L|g\/mol|g\/cm\^3|kg\/m\^3)/gi,
    '$1'
  );
  // Strip standalone degree / common physics & chemistry unit words/symbols immediately following a number
  cleaned = cleaned.replace(
    /(\d(?:\.\d+)?)\s*(?:°[CFK]|deg\s*[CFK]|kilograms?|grams?|meters?|metres?|seconds?|joules?|newtons?|kelvins?|moles?|watts?|pascals?|hertz|liters?|litres?|kJ|kN|kPa|kW|kg|mg|km|cm|mm|mL|ms|mol|Pa|Hz|[gJmNsKWVCL])(?=$|[\s)\]*/^+-])/g,
    '$1'
  );
  return cleaned.trim();
}

function evaluateArithmeticOrWithUnits(part: string): number | null {
  const direct = safeEvaluateArithmetic(part);
  if (direct !== null) return direct;
  const stripped = stripPhysicalUnits(part);
  if (!stripped || stripped === part) return null;
  return safeEvaluateArithmetic(stripped);
}

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let start = i;
      let hasDot = ch === '.';
      i += 1;
      while (i < expr.length && (/[0-9]/.test(expr[i]) || (!hasDot && expr[i] === '.'))) {
        if (expr[i] === '.') hasDot = true;
        i += 1;
      }
      // Scientific notation e.g. 1.5e-3
      if (i < expr.length && (expr[i] === 'e' || expr[i] === 'E')) {
        const next = expr[i + 1];
        if (next && (/[0-9]/.test(next) || ((next === '+' || next === '-') && /[0-9]/.test(expr[i + 2] ?? '')))) {
          i += 1;
          if (expr[i] === '+' || expr[i] === '-') i += 1;
          while (i < expr.length && /[0-9]/.test(expr[i])) i += 1;
        }
      }
      const num = Number(expr.slice(start, i));
      if (!Number.isFinite(num)) return null;
      // Optional percent suffix e.g. 15%
      if (expr[i] === '%') {
        tokens.push({ type: 'num', value: num / 100 });
        i += 1;
      } else {
        tokens.push({ type: 'num', value: num });
      }
      continue;
    }

    if (/[a-zA-Z]/.test(ch)) {
      let start = i;
      while (i < expr.length && /[a-zA-Z0-9]/.test(expr[i])) i += 1;
      const ident = expr.slice(start, i).toLowerCase();
      if (ident in CONSTANTS) {
        tokens.push({ type: 'num', value: CONSTANTS[ident] });
      } else if (ident in FUNCTIONS) {
        tokens.push({ type: 'fn', value: ident });
      } else {
        // Contains symbolic variable or unit text — not a pure numeric expression
        return null;
      }
      continue;
    }

    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }

    return null;
  }

  return tokens;
}

export function safeEvaluateArithmetic(rawExpression: string): number | null {
  const normalized = normalizeMathString(rawExpression);
  if (!normalized || normalized.length > 200) return null;

  const tokens = tokenize(normalized);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;

    while (peek()?.type === 'op' && (peek() as { value: string }).value.match(/^[+-]$/)) {
      const op = (consume() as { value: string }).value;
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parsePower();
    if (left === null) return null;

    while (peek()?.type === 'op' && (peek() as { value: string }).value.match(/^[*/]$/)) {
      const op = (consume() as { value: string }).value;
      const right = parsePower();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };

  const parsePower = (): number | null => {
    let base = parseUnary();
    if (base === null) return null;

    if (peek()?.type === 'op' && (peek() as { value: string }).value === '^') {
      consume();
      const exponent = parsePower();
      if (exponent === null) return null;
      base = Math.pow(base, exponent);
    }
    return base;
  };

  const parseUnary = (): number | null => {
    if (peek()?.type === 'op' && ((peek() as { value: string }).value === '-' || (peek() as { value: string }).value === '+')) {
      const op = (consume() as { value: string }).value;
      const val = parseUnary();
      if (val === null) return null;
      return op === '-' ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    const tok = peek();
    if (!tok) return null;

    if (tok.type === 'num') {
      consume();
      return tok.value;
    }

    if (tok.type === 'fn') {
      consume();
      if (peek()?.type !== 'lparen') return null;
      consume();
      const args: number[] = [];
      if (peek()?.type !== 'rparen') {
        while (true) {
          const arg = parseExpression();
          if (arg === null) return null;
          args.push(arg);
          if (peek()?.type === 'comma') {
            consume();
          } else {
            break;
          }
        }
      }
      if (peek()?.type !== 'rparen') return null;
      consume();
      const fn = FUNCTIONS[tok.value];
      const out = fn(...args);
      return Number.isFinite(out) ? out : null;
    }

    if (tok.type === 'lparen') {
      consume();
      const val = parseExpression();
      if (val === null || peek()?.type !== 'rparen') return null;
      consume();
      return val;
    }

    return null;
  };

  const result = parseExpression();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

function extractLeadingNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, '').replace(/≈|~=/g, '=').trim();
  const match = cleaned.match(/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function numbersApproximatelyEqual(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff <= 0.015) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && diff / scale <= 0.008; // 0.8% rounding tolerance
}

function formatComputed(val: number): string {
  if (Number.isInteger(val)) return String(val);
  return Number(val.toPrecision(6)).toString();
}

export function verifyCalculationStep(step: CalculationStep): CalculationStep {
  if (!step.expression) return step;

  // Split chained equalities like "F = 5 * 9.8 = 49 N" or "Q = 100 g * 4.186 J/(g*°C) * 10 °C = 4186 J"
  const parts = step.expression
    .replace(/≈|≃/g, '=')
    .split('=')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 2) return step;

  // Look for an evaluatable arithmetic part followed by a stated numeric result
  for (let i = 0; i < parts.length - 1; i++) {
    const lhsVal = evaluateArithmeticOrWithUnits(parts[i]);
    if (lhsVal === null) continue;

    const rhsVal =
      evaluateArithmeticOrWithUnits(parts[i + 1]) ?? extractLeadingNumber(parts[i + 1]);
    if (rhsVal === null) continue;

    const isMatch = numbersApproximatelyEqual(lhsVal, rhsVal);
    return {
      ...step,
      verified: isMatch,
      computedValue: formatComputed(lhsVal),
    };
  }

  return step;
}

function extractTrailingEvaluatableValue(expression: string): number | null {
  const parts = expression
    .replace(/≈|≃/g, '=')
    .split('=')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const lastPart = parts[parts.length - 1];
  // Require at least one arithmetic operator so plain constants aren't treated as formulas
  if (!/[+\-*/^×·÷]/.test(lastPart)) return null;
  return evaluateArithmeticOrWithUnits(lastPart);
}

export function verifyNumericalSolution(solution: NumericalSolution): NumericalSolution {
  const verifiedSteps = solution.steps.map(verifyCalculationStep);

  // If no single step contained "expr = result", verify split substitution -> result across steps / finalAnswer
  if (!verifiedSteps.some((s) => typeof s.verified === 'boolean')) {
    const finalNum = extractLeadingNumber(solution.finalAnswer);

    for (let i = 0; i < verifiedSteps.length; i++) {
      const expr = verifiedSteps[i].expression;
      if (!expr) continue;
      const evaluated = extractTrailingEvaluatableValue(expr);
      if (evaluated === null) continue;

      // Compare against next step's stated value or overall finalAnswer
      let targetNum: number | null = null;
      const nextExpr = verifiedSteps[i + 1]?.expression;
      if (nextExpr) {
        const nextParts = nextExpr.replace(/≈|≃/g, '=').split('=').map((p) => p.trim()).filter(Boolean);
        const lastNext = nextParts[nextParts.length - 1];
        if (lastNext) {
          targetNum = evaluateArithmeticOrWithUnits(lastNext) ?? extractLeadingNumber(lastNext);
        }
      }
      if (targetNum === null) {
        targetNum = finalNum;
      }

      if (targetNum !== null) {
        verifiedSteps[i] = {
          ...verifiedSteps[i],
          verified: numbersApproximatelyEqual(evaluated, targetNum),
          computedValue: formatComputed(evaluated),
        };
        break;
      }
    }
  }

  const checkedSteps = verifiedSteps.filter((s) => typeof s.verified === 'boolean');
  const passedCount = checkedSteps.filter((s) => s.verified === true).length;
  const failedCount = checkedSteps.filter((s) => s.verified === false).length;

  let verifiedProgrammatically = false;
  let verificationNote: string | undefined;

  if (checkedSteps.length > 0 && failedCount === 0) {
    verifiedProgrammatically = true;
    verificationNote = `Verified ${passedCount} arithmetic ${
      passedCount === 1 ? 'step' : 'steps'
    } programmatically.`;
  } else if (failedCount > 0) {
    verifiedProgrammatically = false;
    verificationNote = `Arithmetic check flagged ${failedCount} step ${
      failedCount === 1 ? 'discrepancy' : 'discrepancies'
    }; review intermediate rounding carefully.`;
  } else {
    // Attempt verifying final answer if expression has direct arithmetic
    const directVal = evaluateArithmeticOrWithUnits(solution.finalAnswer);
    if (directVal !== null) {
      verifiedProgrammatically = true;
      verificationNote = 'Numeric expression evaluated programmatically.';
    }
  }

  return {
    ...solution,
    steps: verifiedSteps,
    verifiedProgrammatically,
    verificationNote,
  };
}
