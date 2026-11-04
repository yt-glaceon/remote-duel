/**
 * LP の表示。デュエルで使う電卓に合わせた7セグメントの数字を、フォントを使わず SVG で描く。
 * 消えている線も薄く残し、桁が足りないところも空の桁として見せる
 */
const T = 10; // 線の太さ
const LEN_H = 48;
const LEN_V = 42;
const GAP = 1.5;
const CELL = 68; // 1桁の幅
const HEIGHT = 94;
const SLANT = 9; // 斜体にした分の横幅

function horizontal(x: number, y: number) {
  const a = x + GAP;
  const b = x + LEN_H - GAP;
  return `M${a} ${y}L${a + T / 2} ${y - T / 2}H${b - T / 2}L${b} ${y}L${b - T / 2} ${y + T / 2}H${a + T / 2}Z`;
}

function vertical(x: number, y: number) {
  const a = y + GAP;
  const b = y + LEN_V - GAP;
  return `M${x} ${a}L${x + T / 2} ${a + T / 2}V${b - T / 2}L${x} ${b}L${x - T / 2} ${b - T / 2}V${a + T / 2}Z`;
}

const SEG: Record<string, string> = {
  a: horizontal(5, 5),
  b: vertical(53, 5),
  c: vertical(53, 47),
  d: horizontal(5, 89),
  e: vertical(5, 47),
  f: vertical(5, 5),
  g: horizontal(5, 47),
};
const ALL = Object.values(SEG).join('');
const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'].map((on) =>
  [...on].map((s) => SEG[s]).join(''),
);

export function SevenSeg({ value, digits = 5, className = '' }: { value: number; digits?: number; className?: string }) {
  const text = String(value);
  const cells = Math.max(digits, text.length);
  const lit = text.padStart(cells, ' ');
  return (
    <svg className={`seven-seg ${className}`} viewBox={`0 0 ${cells * CELL - 10 + SLANT} ${HEIGHT}`} aria-hidden>
      <g transform={`translate(${SLANT} 0) skewX(-5.5)`}>
        {[...lit].map((c, i) => (
          <g key={i} transform={`translate(${i * CELL} 0)`}>
            <path className="seg-off" d={ALL} />
            {c !== ' ' && <path className="seg-on" d={DIGITS[Number(c)]} />}
          </g>
        ))}
      </g>
    </svg>
  );
}
