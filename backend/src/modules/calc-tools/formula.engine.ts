/**
 * 白名单表达式求值器。
 *
 * 为什么自己写而不用 eval / new Function：计算模板的公式串存在数据库里，
 * 管理员可编辑 —— 任何能执行任意 JS 的方案都等于把服务器交给了模板编辑者。
 * 这里只认数字、变量名、四则运算和一张固定的函数表，语法之外的一律报错。
 *
 * 支持：+ - * / % ^、括号、一元负号、变量、下表函数、常量 PI / E。
 */

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

/** 允许调用的函数。参数个数由 arity 校验，避免误用被当成 0 静默通过。 */
const FUNCTIONS: Record<string, { arity: number | 'variadic'; fn: (...a: number[]) => number }> = {
  abs: { arity: 1, fn: Math.abs },
  sqrt: { arity: 1, fn: Math.sqrt },
  ceil: { arity: 1, fn: Math.ceil },
  floor: { arity: 1, fn: Math.floor },
  ln: { arity: 1, fn: Math.log },
  log10: { arity: 1, fn: Math.log10 },
  exp: { arity: 1, fn: Math.exp },
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  atan: { arity: 1, fn: Math.atan },
  /** round(x) 或 round(x, 小数位) */
  round: {
    arity: 'variadic',
    fn: (x: number, digits = 0) => {
      const f = Math.pow(10, digits);
      return Math.round(x * f) / f;
    },
  },
  min: { arity: 'variadic', fn: (...a: number[]) => Math.min(...a) },
  max: { arity: 'variadic', fn: (...a: number[]) => Math.max(...a) },
  pow: { arity: 2, fn: Math.pow },
  /** if(条件, 真值, 假值) —— 条件非 0 即真，用于分档系数 */
  if: { arity: 3, fn: (c: number, a: number, b: number) => (c ? a : b) },
};

const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

const PRECEDENCE: Record<string, number> = {
  '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1,
  '+': 2, '-': 2,
  '*': 3, '/': 3, '%': 3,
  '^': 4,
  'u-': 5,
};

const RIGHT_ASSOC = new Set(['^', 'u-']);

export class FormulaError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new FormulaError(`无效数字：${raw}`);
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }

    if (/[A-Za-z_一-龥]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_一-龥]/.test(input[j])) j += 1;
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // 双字符比较运算符优先匹配
    const two = input.slice(i, i + 2);
    if (['<=', '>=', '==', '!='].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    if ('+-*/%^<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i += 1; continue; }
    if (ch === ',') { tokens.push({ type: 'comma' }); i += 1; continue; }

    throw new FormulaError(`公式中出现不支持的字符：${ch}`);
  }

  return tokens;
}

/** 调度场算法：中缀 → 逆波兰 */
function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Array<Token | { type: 'func'; value: string; argc: number }> = [];
  const argCounts: number[] = [];

  let prev: Token | null = null;

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (token.type === 'num') {
      output.push(token);
    } else if (token.type === 'ident') {
      // 只有后面紧跟 ( 才是函数调用；否则是变量/常量，直接进输出队列。
      // （曾经把所有标识符都压运算符栈，导致 `a * b` 的操作数顺序被打乱）
      const isCall = tokens[idx + 1]?.type === 'lparen';
      if (isCall) stack.push(token);
      else output.push(token);
    } else if (token.type === 'comma') {
      while (stack.length && (stack[stack.length - 1] as Token).type !== 'lparen') {
        output.push(stack.pop() as Token);
      }
      if (!stack.length) throw new FormulaError('括号不匹配');
      if (argCounts.length) argCounts[argCounts.length - 1] += 1;
    } else if (token.type === 'op') {
      // 判定一元负号：出现在开头、运算符后、左括号后或逗号后
      const unary =
        token.value === '-' &&
        (prev === null || prev.type === 'op' || prev.type === 'lparen' || prev.type === 'comma');
      const op = unary ? 'u-' : token.value;

      while (stack.length) {
        const top = stack[stack.length - 1] as Token;
        if (top.type !== 'op') break;
        const topPrec = PRECEDENCE[top.value] ?? 0;
        const curPrec = PRECEDENCE[op] ?? 0;
        if (topPrec > curPrec || (topPrec === curPrec && !RIGHT_ASSOC.has(op))) {
          output.push(stack.pop() as Token);
        } else break;
      }
      stack.push({ type: 'op', value: op });
    } else if (token.type === 'lparen') {
      // 前一个是标识符 → 这是函数调用，开一个参数计数
      if (prev?.type === 'ident') argCounts.push(1);
      stack.push(token);
    } else if (token.type === 'rparen') {
      while (stack.length && (stack[stack.length - 1] as Token).type !== 'lparen') {
        output.push(stack.pop() as Token);
      }
      if (!stack.length) throw new FormulaError('括号不匹配');
      stack.pop(); // 弹出 lparen

      const top = stack[stack.length - 1] as Token | undefined;
      if (top?.type === 'ident') {
        stack.pop();
        const argc = argCounts.pop() ?? 0;
        output.push({ type: 'ident', value: `${top.value}#${argc}` });
      }
    }

    prev = token;
  }

  while (stack.length) {
    const top = stack.pop() as Token;
    if (top.type === 'lparen') throw new FormulaError('括号不匹配');
    output.push(top);
  }

  return output;
}

/**
 * 求值。变量取自 scope；未定义的变量报错而不是当 0 ——
 * 静默当 0 会算出一个看似合理的错误数字，比直接报错危险得多。
 */
export function evaluateFormula(expression: string, scope: Record<string, number>): number {
  if (!expression || !expression.trim()) throw new FormulaError('公式为空');

  const rpn = toRpn(tokenize(expression));
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'num') {
      stack.push(token.value);
      continue;
    }

    if (token.type === 'ident') {
      // 函数调用被编码成 name#argc
      const hashIdx = token.value.lastIndexOf('#');
      if (hashIdx > 0) {
        const name = token.value.slice(0, hashIdx);
        const argc = Number(token.value.slice(hashIdx + 1));
        const def = FUNCTIONS[name];
        if (!def) throw new FormulaError(`不支持的函数：${name}()`);
        if (def.arity !== 'variadic' && def.arity !== argc) {
          throw new FormulaError(`${name}() 需要 ${def.arity} 个参数，实际传入 ${argc} 个`);
        }
        if (stack.length < argc) throw new FormulaError(`${name}() 参数不足`);
        const args = stack.splice(stack.length - argc, argc);
        const value = def.fn(...args);
        if (!Number.isFinite(value)) throw new FormulaError(`${name}() 计算结果无效`);
        stack.push(value);
        continue;
      }

      // hasOwnProperty 而非 in：`constructor`、`toString` 等原型链上的名字
      // 用 `in` 会判为已定义，从而把函数对象当成数值参与运算
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, token.value)) {
        stack.push(CONSTANTS[token.value]);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(scope, token.value)) {
        throw new FormulaError(`未定义的变量：${token.value}`);
      }
      const v = Number(scope[token.value]);
      if (!Number.isFinite(v)) throw new FormulaError(`变量 ${token.value} 不是有效数字`);
      stack.push(v);
      continue;
    }

    if (token.type === 'op') {
      if (token.value === 'u-') {
        if (!stack.length) throw new FormulaError('一元负号缺少操作数');
        stack.push(-stack.pop()!);
        continue;
      }
      if (stack.length < 2) throw new FormulaError(`运算符 ${token.value} 缺少操作数`);
      const b = stack.pop()!;
      const a = stack.pop()!;
      let r: number;
      switch (token.value) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/':
          if (b === 0) throw new FormulaError('除数为 0');
          r = a / b;
          break;
        case '%':
          if (b === 0) throw new FormulaError('取模的除数为 0');
          r = a % b;
          break;
        case '^': r = Math.pow(a, b); break;
        case '<': r = a < b ? 1 : 0; break;
        case '>': r = a > b ? 1 : 0; break;
        case '<=': r = a <= b ? 1 : 0; break;
        case '>=': r = a >= b ? 1 : 0; break;
        case '==': r = a === b ? 1 : 0; break;
        case '!=': r = a !== b ? 1 : 0; break;
        default: throw new FormulaError(`不支持的运算符：${token.value}`);
      }
      if (!Number.isFinite(r)) throw new FormulaError('计算结果溢出或无效');
      stack.push(r);
      continue;
    }

    throw new FormulaError('公式解析失败');
  }

  if (stack.length !== 1) throw new FormulaError('公式不完整');
  return stack[0];
}

/** 保存模板前做一次静态校验：只检查语法与函数名，不需要真实数据 */
export function validateFormula(expression: string, knownVars: string[]): string | null {
  try {
    const scope: Record<string, number> = {};
    for (const v of knownVars) scope[v] = 1;
    evaluateFormula(expression, scope);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : '公式无效';
  }
}
