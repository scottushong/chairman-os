'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { cancelEcountImport, previewEcountImport } from '@/app/actions/ecount-import'
import type { SheetOutline } from '@/lib/ecount/excel/workbook'
import { FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImportKind } from '@/types'

import { EcountOutline } from './ecount-outline'

/**
 * 진행 중(draft) 업로드 목록 — 회사의 재무 읽기 권한자에게 다 보이고(0050 finance_imports_read),
 * 이어 가기 · 취소는 만든 본인만(0050 finance_imports_update). 버튼이 없어도 서버가 다시 판정한다.
 */

export interface EcountDraftRow {
  import_id: string
  kind: FinanceImportKind
  file_name: string
  created_at: string
  /** 원본 첨부가 붙었는가 */
  hasFile: boolean
  /** 서버가 원본을 읽어 해시를 적었는가(미리보기 공통부를 지났는가) */
  checked: boolean
  mine: boolean
  outline: SheetOutline[] | null
}

export function EcountImportDrafts({ drafts }: { drafts: EcountDraftRow[] }) {
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="진행 중인 업로드">
      <h2 className="text-t13 font-semibold">
        진행 중 <span className="text-t11 font-normal text-ink-muted">{drafts.length}건</span>
      </h2>
      {drafts.length === 0 ? (
        <p className="mt-2 text-t11 text-ink-muted">진행 중인 업로드가 없습니다.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {drafts.map((d) => (
            <DraftItem key={d.import_id} d={d} />
          ))}
        </ul>
      )}
    </section>
  )
}

function DraftItem({ d }: { d: EcountDraftRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [outline, setOutline] = useState<SheetOutline[] | null>(d.outline)

  const status = !d.hasFile ? '원본 없음' : d.checked ? '미리보기: 열 구성 확인 후 제공' : '원본 확인 전'

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded bg-raised px-1.5 py-0.5 text-t10h text-ink-dim">{FINANCE_IMPORT_KIND_LABEL_KO[d.kind]}</span>
        <span className="min-w-0 truncate text-t12h font-semibold text-ink">{d.file_name}</span>
        <span className="text-t10h text-ink-muted">
          {d.mine ? '내 업로드' : '다른 담당자'} · {d.created_at.slice(0, 10)} · {status}
        </span>
        {d.mine ? (
          <span className="ml-auto flex gap-1.5">
            {d.hasFile ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setMsg(null)
                    const r = await previewEcountImport(d.import_id)
                    if (r.outline) setOutline(r.outline)
                    if (r.pending) setMsg({ text: '서버가 원본을 다시 읽었습니다. 미리보기는 열 구성 확인 후 제공합니다.', tone: 'info' })
                    else if (r.error) setMsg({ text: r.error, tone: 'error' })
                    router.refresh()
                  })
                }
                className="min-h-11 rounded px-1.5 text-t10h text-accent hover:underline disabled:opacity-50 lg:min-h-0 lg:py-0.5"
              >
                다시 읽기
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm(`«${d.file_name}» 업로드를 취소합니다. 올린 원본도 지워집니다.`)) return
                start(async () => {
                  setMsg(null)
                  const r = await cancelEcountImport(d.import_id)
                  if (r.error) setMsg({ text: r.error, tone: 'error' })
                  router.refresh()
                })
              }}
              className="min-h-11 rounded px-1.5 text-t10h text-critical hover:underline disabled:opacity-50 lg:min-h-0 lg:py-0.5"
            >
              취소
            </button>
          </span>
        ) : null}
      </div>
      {pending ? <p className="mt-1 text-t11 text-accent">처리 중…</p> : null}
      {msg ? (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-1 text-t11 ${msg.tone === 'error' ? 'text-critical' : 'text-ink-dim'}`}>
          {msg.text}
        </p>
      ) : null}
      {outline ? (
        <div className="mt-1.5">
          <EcountOutline outline={outline} />
        </div>
      ) : null}
    </li>
  )
}
