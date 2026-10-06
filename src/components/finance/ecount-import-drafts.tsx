'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { cancelEcountImport, previewEcountImport, type EcountPreviewState } from '@/app/actions/ecount-import'
import type { SheetOutline } from '@/lib/ecount/excel/workbook'
import { FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImportKind } from '@/types'

import { EcountImportFlow } from './ecount-import-flow'
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
  /** 사람이 열 지정을 확정했는가(summary.mapping) */
  mapped: boolean
  mine: boolean
  outline: SheetOutline[] | null
}

export function EcountImportDrafts({ drafts }: { drafts: EcountDraftRow[] }) {
  // 방금 등록한 업로드의 결과 — 등록 뒤 새로 고침에서 그 줄은 목록(draft만)에서 빠지므로 문장을 여기(목록 단)에 둔다.
  // 사람이 닫을 때까지 남는다. 목록 컴포넌트는 새로 고침에도 그대로라 상태가 유지된다.
  const [recent, setRecent] = useState<{ import_id: string; file_name: string; text: string }[]>([])
  // 이어 간 업로드의 거절 · 오류 문구도 목록 단에 둔다(0056 마무리 — «방금 등록됨»과 같은 길). 줄(DraftItem)이 새로 고침에
  // 다시 그려지거나 목록에서 빠져도 문구가 남는다. 다음 동작을 시작하면 그 줄이 지운다 · 사람이 닫을 때까지 남는다.
  const [notes, setNotes] = useState<Record<string, DraftNote>>({})
  const shown = new Set(drafts.map((d) => d.import_id))
  const setNote = (d: EcountDraftRow) => (note: Omit<DraftNote, 'file_name'> | null) =>
    setNotes((all) => {
      const next = { ...all }
      if (note) next[d.import_id] = { ...note, file_name: d.file_name }
      else delete next[d.import_id]
      return next
    })
  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4" aria-label="진행 중인 업로드">
      <h2 className="text-t13 font-semibold">
        진행 중 <span className="text-t11 font-normal text-ink-muted">{drafts.length}건</span>
      </h2>
      {recent.filter((r) => !shown.has(r.import_id)).map((r) => (
        <div key={r.import_id} role="status" className="mt-2 flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-t11h text-ink">
          <p className="min-w-0 flex-1">
            <span className="font-semibold">방금 등록됨 · {r.file_name}</span> — {r.text}
          </p>
          <button
            type="button"
            onClick={() => setRecent((all) => all.filter((x) => x.import_id !== r.import_id))}
            className="min-h-11 shrink-0 rounded px-1.5 text-t10h text-accent hover:underline lg:min-h-0 lg:py-0.5"
          >
            닫기
          </button>
        </div>
      ))}
      {Object.entries(notes)
        .filter(([id]) => !shown.has(id))
        .map(([id, n]) => (
          <div
            key={`note-${id}`}
            role={n.tone === 'error' ? 'alert' : 'status'}
            className={`mt-2 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-t11h ${
              n.tone === 'error' ? 'border-critical/40 bg-critical/10 text-critical' : 'border-line-soft bg-raised/40 text-ink-dim'
            }`}
          >
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{n.tone === 'error' ? '처리하지 못함' : '알림'} · {n.file_name}</span> — {n.text}
            </p>
            <button
              type="button"
              onClick={() => setNotes((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== id)))}
              className="min-h-11 shrink-0 rounded px-1.5 text-t10h text-accent hover:underline lg:min-h-0 lg:py-0.5"
            >
              닫기
            </button>
          </div>
        ))}
      {drafts.length === 0 ? (
        <p className="mt-2 text-t11 text-ink-muted">진행 중인 업로드가 없습니다.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {drafts.map((d) => (
            <DraftItem
              key={d.import_id}
              d={d}
              note={notes[d.import_id] ?? null}
              setNote={setNote(d)}
              onDone={(text) => {
                setNote(d)(null)
                setRecent((all) => [...all.filter((x) => x.import_id !== d.import_id), { import_id: d.import_id, file_name: d.file_name, text }])
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

interface DraftNote {
  text: string
  tone: 'info' | 'error'
  file_name: string
}

function DraftItem({
  d,
  note,
  setNote,
  onDone,
}: {
  d: EcountDraftRow
  /** 이 줄의 거절 · 오류 문구 — 목록(부모)이 들고 있다(새로 고침에도 남게) */
  note: DraftNote | null
  setNote: (note: Omit<DraftNote, 'file_name'> | null) => void
  onDone: (text: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const msg = note
  const setMsg = setNote
  const [outline, setOutline] = useState<SheetOutline[] | null>(d.outline)
  const [flow, setFlow] = useState<EcountPreviewState | null>(null)

  const status = !d.hasFile ? '원본 없음' : d.mapped ? '열 지정 확정' : d.checked ? '열 지정 전' : '원본 확인 전'

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
                    if (r.importId && r.mapping) setFlow(r)
                    else if (r.error) setMsg({ text: r.error, tone: 'error' })
                    router.refresh()
                  })
                }
                className="min-h-11 rounded px-1.5 text-t10h text-accent hover:underline disabled:opacity-50 lg:min-h-0 lg:py-0.5"
              >
                이어 가기
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
      {flow ? (
        <EcountImportFlow
          key={flow.importId}
          initial={flow}
          onDone={onDone}
          onError={(text) => setNote(text ? { text, tone: 'error' } : null)}
        />
      ) : outline ? (
        <div className="mt-1.5">
          <EcountOutline outline={outline} />
        </div>
      ) : null}
    </li>
  )
}
