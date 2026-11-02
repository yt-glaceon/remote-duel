// LP 欄の入力の解釈。数値でも式でも受け付ける
//   1800、2400*2、2500-1900  → ダメージ
//   +500、+(1000*2)          → 回復
//   =4000、=8000/2           → 値の指定
// eval は使わず、四則演算と括弧だけの小さな構文解析で計算する

export type LpOp = { kind: 'damage' | 'heal' | 'set'; amount: number };

const MAX = 999_999;

/** 全角の数字・記号や ×÷ を半角の演算子にそろえる */
function normalize(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＋]/g, '+')
    .replace(/[－−ー‐]/g, '-')
    .replace(/[×＊xX]/g, '*')
    .replace(/[÷／]/g, '/')
    .replace(/[＝]/g, '=')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[．]/g, '.')
    .replace(/[,，、\s]/g, '');
}

/** 四則演算の式を計算する。解釈できなければ null */
export function evaluate(expr: string): number | null {
  let i = 0;
  const peek = () => expr[i];

  const number = (): number | null => {
    const m = /^\d+(\.\d+)?/.exec(expr.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };

  const factor = (): number | null => {
    if (peek() === '-') {
      i++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '(') {
      i++;
      const v = sum();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return number();
  };

  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = expr[i++];
      const r = factor();
      if (r === null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };

  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = expr[i++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  if (!expr || expr.length > 100) return null;
  const v = sum();
  return v !== null && i === expr.length && Number.isFinite(v) ? v : null;
}

/** 入力欄の文字列を LP の操作に変換する。mode を渡すと先頭の記号より優先する */
export function parseLpInput(raw: string, mode?: LpOp['kind']): LpOp | null {
  let s = normalize(raw);
  let kind: LpOp['kind'] = 'damage';
  if (s.startsWith('=')) {
    kind = 'set';
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    kind = 'heal';
    s = s.slice(1);
  }
  const v = evaluate(s);
  if (v === null) return null;
  // 端数は切り上げ(LP 半分のときと同じ扱い)
  const amount = Math.ceil(Math.abs(v) - 1e-9);
  if (amount > MAX) return null;
  return { kind: mode ?? kind, amount };
}
