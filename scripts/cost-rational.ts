/** 원가 엔진 검사의 유리수(BigInt) 도우미 — 부동소수 없이 «원래 값»을 만든다. check-cost-engine · cost-engine-overheads가 같이 쓴다. */
/** 유리수 n/d(d > 0). 부동소수 없이 «원래 값»을 만든다. */
export type Q = { n: bigint; d: bigint }
export const gcd = (a: bigint, b: bigint): bigint => (b === BigInt(0) ? (a < BigInt(0) ? -a : a) : gcd(b, a % b))
export const qn = (n: bigint, d: bigint): Q => {
  const s = d < BigInt(0) ? -BigInt(1) : BigInt(1)
  const g = gcd(n, d) || BigInt(1)
  return { n: (s * n) / g, d: (s * d) / g }
}
/** '1234.5678' · 12 → 유리수. */
export const Qof = (v: string | number): Q => {
  const str = String(v)
  const neg = str.startsWith('-')
  const [i, f = ''] = (neg ? str.slice(1) : str).split('.')
  return qn((neg ? -BigInt(1) : BigInt(1)) * BigInt(i + f), BigInt(10) ** BigInt(f.length))
}
export const qadd = (a: Q, b: Q) => qn(a.n * b.d + b.n * a.d, a.d * b.d)
export const qsub = (a: Q, b: Q) => qn(a.n * b.d - b.n * a.d, a.d * b.d)
export const qmul = (a: Q, b: Q) => qn(a.n * b.n, a.d * b.d)
export const qdiv = (a: Q, b: Q) => qn(a.n * b.d, a.d * b.n)
export const qsum = (xs: Q[]) => xs.reduce(qadd, Qof(0))
/** Postgres round(x, 0) — 0.5는 0에서 먼 쪽. */
export const qround = (a: Q): bigint => {
  const neg = a.n < BigInt(0)
  const n = neg ? -a.n : a.n
  const r = (BigInt(2) * n + a.d) / (BigInt(2) * a.d)
  return neg ? -r : r
}
/** 소수 부분(0 ≤ f < 1, 양수만). */
export const qfrac = (a: Q): Q => qn(a.n % a.d, a.d)
/** |a − b| < 1e-9 */
export const qnear = (a: Q, b: Q) => {
  const x = qsub(a, b)
  return (x.n < BigInt(0) ? -x.n : x.n) * BigInt(1_000_000_000) < x.d
}
/** 소수 4자리 문자열(반올림) — numeric(20, 4) 칸에 넣을 값. */
export const q4 = (a: Q): string => {
  const r = qround(qmul(a, Qof(10000)))
  const s = (r < BigInt(0) ? -r : r).toString().padStart(5, '0')
  return `${r < BigInt(0) ? '-' : ''}${s.slice(0, -4)}.${s.slice(-4)}`
}

