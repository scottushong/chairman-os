'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { cancelQuoteAction, confirmQuoteAction, requestQuoteApprovalAction } from '@/app/actions/quotes'
import { Alert, BTN, BTN_PRIMARY } from '@/components/purchasing/shared'
import type { Quote, QuoteShownStatus } from '@/types'

/**
 * 견적 상세의 버튼 — 만든 사람 · 대표에게만 그린다(판정은 DB가 다시 한다).
 *   초안 Green/Yellow → 확정 · 초안 Red → 대표 승인 요청 · 승인 대기(결재 승인됨) → 확정 · 초안/승인 대기 → 취소 · 확정 → 고객용 견적서.
 */
export function QuoteActions({ quote, shown, decisionStatus }: { quote: Quote; shown: QuoteShownStatus; decisionStatus: string | null }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }
  const biz = quote.business_id
  const id = quote.quote_id
  const live = shown === 'draft' || shown === 'pending_approval'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {shown === 'draft' && quote.grade !== 'red' ? (
          <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => run(() => confirmQuoteAction(biz, id))}>
            확정
          </button>
        ) : null}
        {shown === 'draft' && quote.grade === 'red' ? (
          <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => run(() => requestQuoteApprovalAction(biz, id))}>
            대표 승인 요청
          </button>
        ) : null}
        {shown === 'pending_approval' && decisionStatus === 'Approved' ? (
          <button type="button" className={BTN_PRIMARY} disabled={pending} onClick={() => run(() => confirmQuoteAction(biz, id))}>
            확정(대표 승인됨)
          </button>
        ) : null}
        {live ? (
          <button type="button" className={BTN} disabled={pending} onClick={() => run(() => cancelQuoteAction(biz, id))}>
            취소
          </button>
        ) : null}
        {shown === 'confirmed' ? (
          <a className={BTN} href={`/sales/${biz}/quotes/${id}/download`}>
            고객용 견적서(엑셀)
          </a>
        ) : null}
      </div>
      <Alert text={error} />
    </div>
  )
}
