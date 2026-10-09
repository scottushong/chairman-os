'use client'

import { useState } from 'react'

/** 구매 화면 공통 모양 — 입력칸 · 버튼 · 알림. 폰은 누를 것 44px(check:mobile). */
export const FIELD_INLINE =
  'rounded border border-line bg-panel px-2 py-1 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50 max-lg:min-h-11'
export const FIELD =
  'w-full rounded border border-line bg-panel px-2 py-1 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50 max-lg:min-h-11'
export const LABEL = 'block text-t10h text-ink-muted'
export const BTN =
  'inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-line bg-panel px-2.5 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5'
export const BTN_PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-3 text-t12 font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5'
export const LINK_BTN = 'min-h-11 rounded px-1.5 text-t11 text-ink-dim hover:text-ink disabled:opacity-40 lg:min-h-0 lg:py-0.5'

export function Alert({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
      {text}
    </p>
  )
}

export function Notice({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="status" className="rounded-md border border-line-soft bg-raised/60 px-2.5 py-1.5 text-t11h text-ink-dim">
      {text}
    </p>
  )
}

/**
 * «무효» — 고치지 않는 기록(시장가 · LOT · 첨부)의 유일한 정정 길(0061). 이유를 적어야 누를 수 있다. 무효는 되돌리지 않는다.
 */
export function VoidButton({ onVoid, label = '무효' }: { onVoid: (reason: string) => Promise<string | undefined>; label?: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className={LINK_BTN} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <input
        className={`${FIELD_INLINE} w-44`}
        value={reason}
        maxLength={300}
        placeholder="무효 이유(필수)"
        aria-label="무효 이유"
        disabled={busy}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        className={LINK_BTN}
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const err = await onVoid(reason.trim())
          setBusy(false)
          if (err) setError(err)
          else setOpen(false)
        }}
      >
        {busy ? '처리 중…' : '무효로'}
      </button>
      <button type="button" className={LINK_BTN} disabled={busy} onClick={() => setOpen(false)}>
        취소
      </button>
      {error ? <span className="w-full text-right text-t10h text-critical">{error}</span> : null}
    </span>
  )
}

export function VoidTag({ reason }: { reason: string | null }) {
  return (
    <span className="ml-1.5 rounded border border-line px-1 text-t9h text-ink-muted" title={reason ?? undefined}>
      무효{reason ? ` · ${reason}` : ''}
    </span>
  )
}

/** 통화 고르기 — 원가 엔진은 kg당 단가 · 원화 환산만 다룬다. 목록 밖 통화는 0061이 받지만 화면은 흔한 것만. */
export const CURRENCIES = ['KRW', 'USD', 'EUR', 'CNY', 'JPY'] as const
