import type { Figure, FigureBasis, PeriodKey, Provenance } from '@/types'

/**
 * 출처 꼬리표의 유일한 판정 자리 (Phase 2-A 원칙: 출처 없는 숫자는 화면에 못 올린다).
 *
 * 꼬리표를 사람이 붙이지 않는다. 원천 행의 (source, closed)가 정한다. 화면이 '확정'이라고 쓰고 싶으면
 * 원천이 마감돼 있어야 한다 — 이 파일 밖에서 FigureBasis 리터럴을 만들면 그게 곧 규칙 위반이다.
 *
 * 0015의 finance_kpis 뷰가 같은 규칙을 SQL로 한 번 더 쓴다(파일 머리 '꼬리표' 절).
 * 둘이 어긋나면 대시보드와 재무 화면이 같은 달을 다르게 부른다. 한쪽을 고치면 다른 쪽도 고친다.
 */

export function basisOf(p: Pick<Provenance, 'source' | 'closed'>): FigureBasis {
  if (p.source === 'manual') return 'manual'
  if (p.source === 'estimate') return 'estimate'
  return p.closed ? 'confirmed' : 'provisional'
}

const RANK: Record<FigureBasis, number> = { confirmed: 0, provisional: 1, manual: 2, estimate: 3 }

/** 가장 약한 꼬리표. 확정 11개월 + 잠정 1개월의 합은 잠정이다. */
export function weakest(bases: FigureBasis[]): FigureBasis {
  return bases.reduce((w, b) => (RANK[b] > RANK[w] ? b : w), 'confirmed' as FigureBasis)
}

/** 원천 행 하나를 Figure로. 부호 뒤집기 같은 변환은 부르는 쪽이 value에 한다. */
export function figureOf(value: number, p: Provenance): Figure {
  return { value, basis: basisOf(p), fetched_at: p.fetched_at }
}

/**
 * 여러 Figure의 합. 하나도 없으면 null이다 — 0이 아니다.
 * '원천이 없다'를 0으로 그리면 꼬리표를 붙일 대상이 없는 숫자가 화면에 서게 된다.
 * fetched_at은 가장 오래된 것을 남긴다. 합계가 믿을 만한 정도는 가장 낡은 재료가 정한다.
 */
export function sumFigures(figures: (Figure | null | undefined)[]): Figure | null {
  const present = figures.filter((f): f is Figure => f !== null && f !== undefined)
  if (present.length === 0) return null
  return {
    value: present.reduce((s, f) => s + f.value, 0),
    basis: weakest(present.map((f) => f.basis)),
    fetched_at: oldest(present.map((f) => f.fetched_at)),
  }
}

/** 값만 바꾸고 출처는 그대로. 부호 뒤집기·비율 계산처럼 원천이 늘지 않는 변환에 쓴다. */
export function mapFigure(f: Figure, fn: (v: number) => number): Figure {
  return { ...f, value: fn(f.value) }
}

/** 두 Figure로 새 값을 만든다. 출처는 둘 중 약한 쪽. */
export function combine2(a: Figure, b: Figure, fn: (x: number, y: number) => number): Figure {
  return {
    value: fn(a.value, b.value),
    basis: weakest([a.basis, b.basis]),
    fetched_at: oldest([a.fetched_at, b.fetched_at]),
  }
}

function oldest(values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => v !== null).sort()
  return present[0] ?? null
}

/** 'YYYY-MM'에 n개월을 더한다. Date를 거치지 않는다 — 시간대 때문에 월말에 하루가 밀리는 일을 없앤다. */
export function addMonths(period: PeriodKey, n: number): PeriodKey {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function periodOfDate(date: string): PeriodKey {
  return date.slice(0, 7)
}
