/**
 * 어시스턴트의 계산기 — **산수는 모델이 아니라 이 코드가 한다**(회장 지시).
 *
 * eval · Function을 쓰지 않는다. 손으로 쓴 토크나이저 + 재귀 하강 파서가 숫자 · 사칙 · 괄호 ·
 * 거듭제곱 · 단항 부호 · 함수 여섯(sum avg min max abs round)만 안다. 그 밖의 글자가 하나라도 있으면
 * 계산하지 않고 거절한다 — «대충 계산됨»은 이 기능에서 가장 나쁜 답이다.
 *
 * Anthropic의 서버 코드 실행(code execution)을 쓰지 않은 이유: 계산에 넣는 숫자가 장부 · 재무라
 * 그 값이 모델 밖 샌드박스로 한 번 더 나가게 된다. 여기서는 숫자가 이 서버를 떠나지 않는다(DEFERRED).
 *
 * 금액(원)은 수조 원까지 double의 정수 구간(2^53) 안이라 합은 정확하다. 나눗셈 · 비율의 부동소수
 * 찌꺼기는 결과를 12자리 유효숫자로 다듬어 없앤다(0.1+0.2 → 0.3).
 */

const FUNCS: Record<string, (args: number[]) => number> = {
  sum: (a) => a.reduce((x, y) => x + y, 0),
  avg: (a) => {
    if (a.length === 0) throw new CalcError('avg()에 값이 없습니다.')
    return a.reduce((x, y) => x + y, 0) / a.length
  },
  min: (a) => {
    if (a.length === 0) throw new CalcError('min()에 값이 없습니다.')
    return Math.min(...a)
  },
  max: (a) => {
    if (a.length === 0) throw new CalcError('max()에 값이 없습니다.')
    return Math.max(...a)
  },
  abs: (a) => {
    if (a.length !== 1) throw new CalcError('abs()는 값 하나를 받습니다.')
    return Math.abs(a[0])
  },
  round: (a) => {
    if (a.length < 1 || a.length > 2) throw new CalcError('round(값, 자리수)입니다.')
    const digits = a[1] ?? 0
    if (!Number.isInteger(digits) || digits < -12 || digits > 12) throw new CalcError('자리수는 -12~12 정수입니다.')
    const f = 10 ** digits
    return Math.round(a[0] * f) / f
  },
}

export class CalcError extends Error {}

type Token = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string }

const MAX_LEN = 2000
const MAX_TOKENS = 600

function tokenize(src: string): Token[] {
  if (src.length > MAX_LEN) throw new CalcError(`식이 너무 깁니다(${MAX_LEN}자까지).`)
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') {
      i++
      continue
    }
    // 숫자: 1234 · 1,234,567(천 단위 쉼표) · 12.5 · 1e9. 쉼표 뒤가 정확히 세 자리일 때만 천 단위로 읽는다 —
    // 아니면 함수 인자 구분이다(sum(1,2)).
    if (/[0-9.]/.test(c)) {
      let j = i
      let text = ''
      while (j < src.length) {
        if (/[0-9.]/.test(src[j])) text += src[j++]
        else if (src[j] === ',' && /^[0-9]{3}(?![0-9])/.test(src.slice(j + 1)) && /[0-9]$/.test(text) && !text.includes('.')) {
          j++
        } else break
      }
      if (/^[eE]$/.test(src[j] ?? '') && /^[+-]?[0-9]/.test(src.slice(j + 1))) {
        text += 'e'
        j++
        if (src[j] === '+' || src[j] === '-') text += src[j++]
        while (j < src.length && /[0-9]/.test(src[j])) text += src[j++]
      }
      if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(text)) throw new CalcError(`숫자를 읽지 못했습니다: ${text}`)
      out.push({ t: 'num', v: Number(text) })
      i = j
      continue
    }
    if ('+-*/^(),%'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (/[a-z]/i.test(c)) {
      let j = i
      while (j < src.length && /[a-z]/i.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    throw new CalcError(`계산기가 모르는 글자입니다: «${c}»`)
  }
  if (out.length > MAX_TOKENS) throw new CalcError('식이 너무 깁니다.')
  return out
}

/** 문법: expr = term (('+'|'-') term)* · term = unary (('*'|'/'|'%') unary)* · unary = '-' unary | pow · pow = atom ('^' unary)? */
class Parser {
  private i = 0
  private depth = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const v = this.expr()
    if (this.i !== this.tokens.length) throw new CalcError('식의 끝을 읽지 못했습니다.')
    return v
  }

  private peek(): Token | undefined {
    return this.tokens[this.i]
  }

  private isOp(v: string): boolean {
    const t = this.peek()
    return t?.t === 'op' && t.v === v
  }

  private expect(v: string) {
    if (!this.isOp(v)) throw new CalcError(`«${v}»가 있어야 합니다.`)
    this.i++
  }

  private expr(): number {
    if (++this.depth > 100) throw new CalcError('괄호가 너무 깊습니다.')
    let v = this.term()
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.i++] as { v: string }).v
      const r = this.term()
      v = op === '+' ? v + r : v - r
    }
    this.depth--
    return v
  }

  private term(): number {
    let v = this.unary()
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.tokens[this.i++] as { v: string }).v
      const r = this.unary()
      if ((op === '/' || op === '%') && r === 0) throw new CalcError('0으로 나눌 수 없습니다.')
      v = op === '*' ? v * r : op === '/' ? v / r : v % r
    }
    return v
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.i++
      return -this.unary()
    }
    if (this.isOp('+')) {
      this.i++
      return this.unary()
    }
    return this.pow()
  }

  private pow(): number {
    const base = this.atom()
    if (this.isOp('^')) {
      this.i++
      const e = this.unary()
      if (Math.abs(e) > 64) throw new CalcError('지수가 너무 큽니다.')
      return base ** e
    }
    return base
  }

  private atom(): number {
    const t = this.peek()
    if (!t) throw new CalcError('식이 중간에 끝났습니다.')
    if (t.t === 'num') {
      this.i++
      return t.v
    }
    if (t.t === 'id') {
      const fn = FUNCS[t.v]
      if (!fn) throw new CalcError(`모르는 함수입니다: ${t.v} (sum avg min max abs round만)`)
      this.i++
      this.expect('(')
      const args: number[] = []
      if (!this.isOp(')')) {
        args.push(this.expr())
        while (this.isOp(',')) {
          this.i++
          args.push(this.expr())
        }
      }
      this.expect(')')
      if (args.length > 500) throw new CalcError('인자가 너무 많습니다.')
      return fn(args)
    }
    if (t.v === '(') {
      this.i++
      const v = this.expr()
      this.expect(')')
      return v
    }
    throw new CalcError(`여기에 «${t.v}»가 올 수 없습니다.`)
  }
}

/** 유효숫자 12자리로 다듬는다. 금액 합(정수)은 그대로 남는다. */
export function tidy(n: number): number {
  if (!Number.isFinite(n)) throw new CalcError('결과가 유한한 수가 아닙니다.')
  if (Number.isInteger(n)) return n
  return Number(n.toPrecision(12))
}

export function evaluate(expression: string): number {
  return tidy(new Parser(tokenize(expression)).parse())
}

/** 정확한 합. 원 단위 금액 목록을 더할 때 쓴다(정수면 그대로, 소수면 tidy). */
export function sumOf(values: number[]): number {
  return tidy(values.reduce((a, b) => a + b, 0))
}
