'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { importLegacyFinance, type LegacyImportView } from '@/app/actions/finance-upload'

/**
 * «예전 자료 가져오기»(2026-10-20 A2) — 자료 올리기 화면 위, 대표에게만(페이지가 대표 · 스위치일 때만 그린다 · 서버도 대표만 받는다).
 * 한 번 누르면 예전 방식 자료 전부를 지금 저장 방식으로 옮기고 체크표가 바로 다시 그려진다. 두 번 눌러도 다시 넣지 않는다.
 */
export function LegacyImportButton({ businessId, done }: { businessId: string; done: number }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [out, setOut] = useState<LegacyImportView | null>(null)
  const fresh = out?.items?.filter((i) => i.fresh) ?? []
  return (
    <section className="rounded-[10px] border border-line bg-card px-[18px] py-3" data-testid="legacy-import">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await importLegacyFinance(businessId)
              setOut(r)
              router.refresh()
            })
          }
          className="min-h-11 rounded-lg border border-accent bg-accent-soft px-4 text-[14px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-50"
        >
          {busy ? '가져오는 중…' : '예전 자료 가져오기'}
        </button>
        <p className="min-w-0 flex-1 text-[13px] text-ink-muted">
          예전 방식으로 올렸던 것(수신함에 남은 파일 · «확인 필요» 대기 · 공식 결산 PDF · 월별 입력)을 지금 저장 방식으로 한 번에 옮깁니다. AI를 쓰지 않고, 두 번 눌러도 다시 넣지 않습니다.
          {done ? ` 앞에서 ${done}건 처리함.` : ''}
        </p>
      </div>
      {out ? (
        <div className="mt-2 text-[13px]" role="status">
          <p className={out.error ? 'text-critical' : 'font-semibold'}>{out.error ?? out.summary}</p>
          {fresh.length ? (
            <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-[13px] text-ink-dim" aria-label="이번에 처리한 것">
              {fresh.map((i, n) => (
                <li key={n} className="rounded bg-raised px-2 py-0.5">
                  <span className="font-semibold">{i.outcome}</span> · {i.source} · {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
