import { formatDeltaPct, formatEok, formatMillion } from '@/lib/format'
import { FIGURE_BASIS_LABEL_KO, type Figure, type FigureBasis } from '@/types'

/**
 * 화면에 숫자를 올리는 유일한 부품 (Phase 2-A 원칙: 출처 없는 숫자는 화면에 못 올린다).
 *
 * number가 아니라 Figure만 받는다. basis가 없는 숫자는 이 컴포넌트를 통과할 수 없고,
 * basis는 lib/ledger/basis.ts가 원천의 source/closed에서만 만든다.
 *
 * 꼬리표 색: 색은 위험에만 쓴다(요구사항서 2번). 확정은 조용히, 잠정은 테두리만,
 * 수기·추정은 경고색 글자 — '이 숫자를 원장처럼 믿지 말라'가 위험 신호이기 때문이다.
 * 색만으로 구분하지 않게 늘 글자(확정/잠정/수기/추정)가 같이 선다.
 */

const TAG_TONE: Record<FigureBasis, string> = {
  confirmed: 'border-transparent bg-raised text-ink-muted',
  provisional: 'border-line text-ink-dim',
  manual: 'border-warning/40 text-warning',
  estimate: 'border-warning/40 text-warning',
}

export function BasisTag({ basis, compact = false }: { basis: FigureBasis; compact?: boolean }) {
  const label = FIGURE_BASIS_LABEL_KO[basis]
  return (
    <span
      title={`출처: ${label}`}
      className={`inline-flex shrink-0 items-center rounded border px-1 align-middle text-[9px] leading-[14px] font-semibold tracking-normal ${TAG_TONE[basis]}`}
    >
      {compact ? label.slice(0, 1) : label}
    </span>
  )
}

export type FigureUnit = 'eok' | 'million' | 'pct' | 'share' | 'months' | 'plain'

export function formatFigure(value: number, unit: FigureUnit, digits?: number): string {
  switch (unit) {
    case 'eok':
      return formatEok(value, digits)
    case 'million':
      return formatMillion(value)
    case 'pct':
      return formatDeltaPct(value)
    case 'share':
      return `${value.toFixed(1)}%`
    case 'months':
      return `${value.toFixed(1)}개월`
    case 'plain':
      return value.toLocaleString('ko-KR', { maximumFractionDigits: digits ?? 2 })
  }
}

/**
 * 숫자 + 꼬리표. figure가 null이면 '—'이고 꼬리표가 없다 — 숫자가 없으면 출처도 없다.
 * signTone: 증감률처럼 부호가 곧 뜻인 숫자. upIsGood이 false면(비용) 색이 뒤집힌다.
 */
export function FigureText({
  figure,
  unit,
  digits,
  compact = false,
  signTone,
  className = '',
}: {
  figure: Figure | null
  unit: FigureUnit
  digits?: number
  compact?: boolean
  signTone?: { upIsGood: boolean }
  className?: string
}) {
  if (!figure) return <span className={`text-ink-muted ${className}`}>—</span>
  const tone =
    signTone && figure.value !== 0
      ? figure.value > 0 === signTone.upIsGood
        ? 'text-ok'
        : 'text-critical'
      : figure.value < 0 && unit !== 'pct'
        ? 'text-critical'
        : ''
  return (
    <span className={`inline-flex items-center gap-1 tnum ${className}`}>
      <span className={tone}>
        {signTone && figure.value !== 0 ? (figure.value > 0 ? '▲ ' : '▼ ') : null}
        {formatFigure(figure.value, unit, digits)}
      </span>
      <BasisTag basis={figure.basis} compact={compact} />
    </span>
  )
}
