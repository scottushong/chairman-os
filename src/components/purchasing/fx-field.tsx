'use client'

import { useRef, useState } from 'react'

import { lookupFxAction } from '@/app/actions/purchasing'
import { NumberInput } from '@/components/ui/number-input'

import { FIELD, LABEL } from './shared'

/**
 * 환율 칸 — 통화가 KRW가 아니면 선다. 기본은 «자동»(0015 fx_rates의 그 날짜 이하 최신 — 저장 때 DB가 같은 값을 다시 찾는다).
 * 사람이 값을 넣으면 그 값이 이긴다(0061 cost_fx: 입력 환율이 있으면 그것). 비우면 다시 자동.
 */
export function FxField({
  currency,
  auto,
  autoLoading,
  value,
  onChange,
  disabled,
}: {
  currency: string
  /** 자동으로 찾은 값. null = 그 날짜 이하 환율이 없음. */
  auto: number | null
  autoLoading: boolean
  /** 사람이 넣은 값(쉼표 문자열). 비면 자동. */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  if (currency === 'KRW') return null
  return (
    <label className={LABEL}>
      환율 (1 {currency} = ? 원)
      <NumberInput
        kind="number"
        unit="원"
        reading={false}
        className={`${FIELD} mt-0.5`}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={autoLoading ? '찾는 중…' : auto !== null ? auto.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '직접 넣으세요'}
        aria-label={`환율 1 ${currency}당 원`}
      />
      <span className="mt-0.5 block text-t10h text-ink-muted">
        {value
          ? '직접 넣은 값으로 계산합니다 — 비우면 자동'
          : autoLoading
            ? '환율 표에서 찾는 중…'
            : auto !== null
              ? '자동 — 환율 표(그 날짜 이하 최신)'
              : '그 날짜의 환율이 없습니다 — 환율을 직접 넣으세요'}
      </span>
    </label>
  )
}

/** 자동 환율 찾기. 통화 · 날짜를 바꾸는 손이 부른다(effect가 아니라) — 늦게 온 옛 답은 버린다. */
export function useFxLookup(initial: number | null = null) {
  const [auto, setAuto] = useState<number | null>(initial)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)
  async function lookup(currency: string, onDate: string) {
    const my = ++seq.current
    if (currency === 'KRW') {
      setAuto(1)
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await lookupFxAction(currency, onDate)
    if (my !== seq.current) return
    setAuto(r.rate)
    setLoading(false)
  }
  return { auto, loading, lookup }
}
