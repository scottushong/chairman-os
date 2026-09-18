'use client'

import { useState } from 'react'

import { removeInitiativeDocAction, saveInitiativeDocAction } from '@/app/actions/initiatives'
import { Icon } from '@/components/ui/icon'
import type { InitiativeDoc } from '@/types'

/**
 * 이니셔티브 문서 링크(0017 initiative_docs). CH-042 문서관리와 별개다 —
 * 저건 사내 스토리지 전체를 보안등급으로 가르는 화면이고, 이건 이 건 하나에 걸린
 * 링크 몇 개를 빠르게 더하고 빼는 자리다.
 *
 * keymen-panel.tsx의 draft 패턴을 따른다: draft가 null이 아닐 때만 폼이 열린다.
 * url은 DB가 `^https?://`를 강제하므로(0017 initiative_docs) 실패하면 그 문장이 그대로 뜬다.
 * 삭제는 removeInitiativeDocAction(docId, initiativeId) — 2인자가 필수다. docId만으로는
 * 어느 상세 화면을 다시 그려야 하는지 알 수 없다.
 */

interface Draft {
  docId?: string
  title: string
  url: string
}

const EMPTY: Draft = { title: '', url: '' }

export function InitiativeDocsPanel({
  initiativeId,
  docs,
  canEdit,
}: {
  initiativeId: string
  docs: InitiativeDoc[]
  canEdit: boolean
}) {
  const [list, setList] = useState(docs)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ko'))

  async function submit() {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    const result = await saveInitiativeDocAction({
      doc_id: draft.docId,
      initiative_id: initiativeId,
      title: draft.title,
      url: draft.url,
    })
    setBusy(false)
    if (result.error || !result.saved) {
      setError(result.error ?? '저장하지 못했습니다.')
      return
    }
    const saved = result.saved
    setList((l) => [...l.filter((d) => d.doc_id !== saved.doc_id), saved])
    setDraft(null)
  }

  async function remove(d: InitiativeDoc) {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await removeInitiativeDocAction(d.doc_id, initiativeId)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setList((l) => l.filter((x) => x.doc_id !== d.doc_id))
  }

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="file-text" className="size-4 text-ink-dim" />
          문서
          <span className="text-[11px] font-normal text-ink-muted tnum">{list.length}건</span>
        </h2>
        {canEdit && !draft ? (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setDraft(EMPTY)
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-accent hover:text-ink"
          >
            <Icon name="plus" className="size-3" />
            추가
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-[11.5px] text-critical">
          {error}
        </p>
      ) : null}

      {draft ? (
        <div className="mt-2.5 grid gap-2 rounded-lg bg-raised/60 p-2.5 md:grid-cols-2">
          <Field
            label="문서명"
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
            maxLength={500}
          />
          <Field
            label="링크"
            value={draft.url}
            placeholder="https://storage.example.co.kr/..."
            onChange={(url) => setDraft({ ...draft, url })}
          />
          <div className="flex items-center gap-1.5 md:col-span-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded bg-accent px-2 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={busy}
              className="rounded px-2 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}

      {sorted.length === 0 && !draft ? (
        <p className="py-5 text-center text-[12px] text-ink-muted">
          등록된 문서가 없습니다.
          {canEdit ? '' : ' 등록은 회장 / 그룹 CFO만 할 수 있습니다.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line-soft">
          {sorted.map((d) => (
            <li key={d.doc_id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[12.5px] font-semibold text-ink underline-offset-2 hover:underline"
                >
                  {d.title}
                </a>
                <p className="truncate text-[10.5px] text-ink-muted">{d.url}</p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`${d.title} 지우기`}
                  onClick={() => remove(d)}
                  disabled={busy}
                  className="shrink-0 rounded px-1 text-[11px] text-ink-muted hover:text-critical disabled:opacity-40"
                >
                  삭제
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return (
    <label className="block text-[10px] font-semibold tracking-[0.08em] text-ink-muted">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] font-normal text-ink outline-none placeholder:text-ink-muted focus:border-accent"
      />
    </label>
  )
}
