'use client'

import { useLayoutEffect, useRef } from 'react'

import { caretAfterDigits, digitsBefore, groupDigits, koreanAmount, parseGrouped, type NumberKind } from '@/lib/number-input'

/**
 * 금액 · 숫자 입력칸 (2026-10-07 회장 지시 3단계). 숫자만 받고 세 자리마다 쉼표를 넣는다 — 한글 · «만» · «억»은 들어가지 않는다.
 * 붙여넣기도 같은 정리(lib/number-input.ts groupDigits). 폰은 숫자 키패드(inputMode). 금액은 옆에 «원», 1만 원 이상이면 아래에
 * 한글 읽기(5,000,000 → 오백만 원). 값은 쉼표가 든 문자열 그대로 부모에게 간다 — 0054 AMOUNT_PATTERN이 받는 모양이다.
 */
export function NumberInput({
  value,
  onChange,
  kind,
  unit = kind === 'money' ? '원' : null,
  reading = kind === 'money',
  className = '',
  ...rest
}: {
  value: string
  onChange: (next: string) => void
  kind: NumberKind
  /** 칸 오른쪽 단위. 금액은 기본 «원». */
  unit?: string | null
  /** 아래 한글 읽기. 금액은 기본 켬. */
  reading?: boolean
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)

  // 쉼표가 새로 끼거나 빠지면 브라우저가 커서를 끝으로 보낸다 — 커서 왼쪽 숫자 개수로 같은 자리에 돌려놓는다.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || caret.current === null || document.activeElement !== el) return
    const at = caretAfterDigits(el.value, caret.current)
    el.setSelectionRange(at, at)
    caret.current = null
  }, [value])

  function accept(el: HTMLInputElement) {
    const next = groupDigits(el.value, kind)
    caret.current = digitsBefore(el.value, el.selectionStart ?? el.value.length)
    // 소수점이나 숫자가 아닌 글자를 쳐서 값이 그대로면 리렌더가 없다 — 칸의 글자를 바로 되돌린다.
    if (next === value) {
      el.value = next
      const at = caretAfterDigits(next, caret.current)
      el.setSelectionRange(at, at)
      caret.current = null
      return
    }
    onChange(next)
  }

  const n = reading ? parseGrouped(value) : null
  return (
    <span className="block">
      <span className="relative block">
        <input
          {...rest}
          ref={ref}
          type="text"
          inputMode={kind === 'money' ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            // 한글 자판 조합 중에는 손대지 않는다 — 조합이 끝날 때(compositionend) 한 번 정리한다.
            if ((e.nativeEvent as InputEvent).isComposing) return
            accept(e.currentTarget)
          }}
          onCompositionEnd={(e) => accept(e.currentTarget)}
          className={`${className} tnum ${unit ? 'pr-8' : ''}`}
        />
        {unit ? (
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-t12 text-ink-muted">
            {unit}
          </span>
        ) : null}
      </span>
      {n !== null && n >= 10000 ? <span className="mt-0.5 block text-t10h text-ink-muted">{koreanAmount(n)}</span> : null}
    </span>
  )
}
