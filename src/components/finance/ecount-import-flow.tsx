'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { commitEcountImport, previewEcountImport, type EcountPreviewState } from '@/app/actions/ecount-import'
import type { AccountOverrides } from '@/lib/ecount/excel/accounts-import'
import type { EcountMapping } from '@/lib/ecount/excel/mapping'

import { EcountAccountsPreview } from './ecount-accounts-preview'
import { EcountAmountsPreview } from './ecount-amounts-preview'
import { EcountMappingEditor } from './ecount-mapping-editor'
import { EcountOutline } from './ecount-outline'

/**
 * 업로드 한 건의 흐름 — 열 지정 → (사람이 확정) → 미리보기 → 등록. 업로드 단과 «진행 중» 목록이 같이 쓴다.
 *
 * 서버가 짐작(또는 지난 업로드의 지정)을 주면 열 지정 화면을 먼저 띄운다. 미리보기는 사람이 «이 열 지정으로
 * 미리보기»를 누른 뒤에만 선다 — 짐작으로는 미리보기 · 등록을 하지 않는다.
 */
export function EcountImportFlow({ initial }: { initial: EcountPreviewState }) {
  const router = useRouter()
  const [state, setState] = useState<EcountPreviewState>(initial)
  const [draft, setDraft] = useState<EcountMapping | null>(initial.mapping ?? null)
  const [editing, setEditing] = useState(initial.mappingSource !== 'confirmed' || !!initial.mappingProblems?.length)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const importId = state.importId!
  const confirmed = state.mappingSource === 'confirmed' && !state.mappingProblems?.length

  async function confirm() {
    if (!draft) return
    setBusy('서버가 원본을 다시 읽어 미리보기를 만드는 중…')
    setError(null)
    try {
      const next = await previewEcountImport(importId, { mapping: draft })
      if (next.error && !next.mapping) {
        setError(next.error)
        return
      }
      setState(next)
      if (next.mapping) setDraft(next.mapping)
      setEditing(!!next.mappingProblems?.length || !!next.error)
      if (next.error) setError(next.error)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  async function commitAccounts(choices: { overrides: AccountOverrides; renames: string[] }) {
    if (!state.mapping) return
    setBusy('서버가 원본을 다시 읽고 등록하는 중…')
    setError(null)
    try {
      const r = await commitEcountImport(importId, { mapping: state.mapping, ...choices })
      if (r.error) setError(r.error)
      else setDone(`등록했습니다 — 새 계정 ${r.added ?? 0}개 · 이름 바꿈 ${r.renamed ?? 0}개. 계정과목 화면에서 «ECOUNT» 출처로 보입니다.`)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  if (done) {
    return (
      <p role="status" className="mt-3 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-t11h text-ink">
        {done}
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      {state.outline ? (
        <details className="rounded-md border border-line-soft bg-raised/30 p-2.5">
          <summary className="cursor-pointer text-t11h text-ink-dim">서버가 다시 읽은 파일 개요</summary>
          <div className="mt-1.5">
            <EcountOutline outline={state.outline} />
          </div>
        </details>
      ) : null}

      {editing && draft && state.grids ? (
        <EcountMappingEditor
          grids={state.grids}
          value={draft}
          source={state.mappingSource ?? 'none'}
          detectedUnit={state.detectedUnit ?? null}
          serverProblems={state.mappingProblems ?? []}
          busy={!!busy}
          onChange={setDraft}
          onConfirm={() => void confirm()}
        />
      ) : confirmed ? (
        <div className="flex flex-wrap items-center gap-2 text-t11h text-ink-dim">
          <span>열 지정 확정됨</span>
          <button type="button" disabled={!!busy} onClick={() => setEditing(true)} className="text-accent hover:underline disabled:opacity-50">
            열 지정 다시 하기
          </button>
        </div>
      ) : null}

      {busy ? <p className="text-t11 text-accent" aria-live="polite">{busy}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}

      {confirmed && !editing && state.accounts ? (
        <EcountAccountsPreview key={JSON.stringify(state.mapping)} input={state.accounts} busy={!!busy} onCommit={(c) => void commitAccounts(c)} />
      ) : null}
      {confirmed && !editing && state.amounts ? <EcountAmountsPreview preview={state.amounts} /> : null}
      {confirmed && !editing && state.kind !== 'accounts' && !state.amounts ? (
        <button type="button" disabled className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink opacity-40 lg:min-h-0 lg:py-1.5">
          등록은 다음 단계(DB 반영 후)에 열립니다
        </button>
      ) : null}
    </div>
  )
}
