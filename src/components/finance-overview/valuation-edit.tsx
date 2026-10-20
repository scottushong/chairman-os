'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveAutoFix } from '@/app/actions/finance-auto'

const SOURCE_KO = { measured: '실측', estimated: '추정', carried: '이월', manual: '고침' } as const
type Src = keyof typeof SOURCE_KO

/**
 * 0091 손익계산서 칸의 재공품 · 완제품 월말 평가 — 출처(실측 · 추정 · 이월 · 고침)를 붙이고, 장부를 쓰는 사람은 그 자리에서 고친다.
 * 고치면 누가 · 언제 · 전값이 «자동으로 정한 것» 목록에 남는다(fin_auto_fixes). 고친 뒤에 평가 파일이 새로 오면 파일 값(실측)이 이긴다 —
 * «자동으로 돌리기»로도 풀린다.
 */
export function ValuationEdit({ businessId, period, rows, canFix }: { businessId: string; period: string; rows: { cat: 'wip' | 'finished'; label: string; value: number | null; source: Src | null }[]; canFix: boolean }) {
  return (
    <div className="mt-1 rounded-md border border-[#e1e6e3] px-3 py-2" data-testid="valuation-edit">
      <div className="text-[14px] font-semibold">
        {period.slice(0, 4)}년 {Number(period.slice(5, 7))}월 말 재고 평가
      </div>
      <div className="mt-1 flex flex-col">
        {rows.map((r) => (
          <One key={r.cat} businessId={businessId} period={period} row={r} canFix={canFix} />
        ))}
      </div>
    </div>
  )
}

function One({ businessId, period, row, canFix }: { businessId: string; period: string; row: { cat: 'wip' | 'finished'; label: string; value: number | null; source: Src | null }; canFix: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [edit, setEdit] = useState(false)
  const [amount, setAmount] = useState(row.value === null ? '' : String(row.value))
  const [msg, setMsg] = useState<string | null>(null)
  const tone = row.source === 'measured' ? 'bg-[#e1efeb] text-[#0f6b5c]' : row.source ? 'bg-[#f8eadf] text-[#9a4b12]' : 'bg-[#f4f5f3] text-[#6b7772]'
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1ef] py-1.5 first:border-t-0">
      <span className="w-16 text-[14px]">{row.label}</span>
      <span className="min-w-[120px] text-right text-[14px] tnum">{row.value === null ? '—' : `${row.value.toLocaleString('ko-KR')}원`}</span>
      <span className={`rounded-full px-2 py-[1px] text-[12px] font-semibold ${tone}`}>{row.source ? SOURCE_KO[row.source] : '자료 없음'}</span>
      {canFix && !edit ? (
        <button type="button" onClick={() => setEdit(true)} className="inline-flex min-h-11 items-center text-[13px] text-[#0f6b5c] hover:underline lg:min-h-0">
          고치기
        </button>
      ) : null}
      {canFix && edit ? (
        <>
          <input aria-label={`${row.label} 금액`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 lg:min-h-8 w-36 rounded-md border border-[#d7ddda] px-2 text-right text-[13px] tnum" />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const r = await saveAutoFix({ businessId, rule: 'valuation', key: `${period}:${row.cat}`, period, action: 'value', value: amount, prev: { 값: row.value, 출처: row.source ? SOURCE_KO[row.source] : null } })
                setMsg(r.error ?? null)
                if (r.ok) {
                  setEdit(false)
                  router.refresh()
                }
              })
            }
            className="min-h-11 lg:min-h-8 rounded-md bg-[#0f6b5c] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={() => setEdit(false)} className="inline-flex min-h-11 items-center text-[13px] text-[#6b7772] hover:underline lg:min-h-0">
            그만
          </button>
        </>
      ) : null}
      {msg ? (
        <span role="status" className="text-[12px] text-[#b4432b]">
          {msg}
        </span>
      ) : null}
    </div>
  )
}
