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
export function EcountImportFlow({
  initial,
  onDone,
  onError,
}: {
  initial: EcountPreviewState
  /**
   * 등록이 끝났을 때 결과 문장을 부모에게도 알린다. «진행 중» 목록에서 이어 간 업로드는 등록 뒤 router.refresh()가 그 줄을
   * 목록(draft만)에서 빼서 이 컴포넌트가 사라진다 — 문장을 목록 단에 올려 두어야 사람이 결과를 본다.
   */
  onDone?: (text: string) => void
  /**
   * 거절 · 오류 문구를 부모가 들고 그린다(«진행 중» 목록 — 0056 마무리). 주면 이 컴포넌트는 문구를 직접 그리지 않는다:
   * 새로 고침에 이 줄이 다시 그려지거나 목록에서 빠져도 사람이 거절 이유를 본다. null = 지움(다음 동작을 시작함).
   */
  onError?: (text: string | null) => void
}) {
  const router = useRouter()
  const [state, setState] = useState<EcountPreviewState>(initial)
  const [draft, setDraft] = useState<EcountMapping | null>(initial.mapping ?? null)
  const [editing, setEditing] = useState(initial.mappingSource !== 'confirmed' || !!initial.mappingProblems?.length)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setErrorText] = useState<string | null>(null)
  function setError(text: string | null) {
    setErrorText(text)
    onError?.(text)
  }
  const [done, setDoneText] = useState<string | null>(null)
  function setDone(text: string) {
    setDoneText(text)
    onDone?.(text)
  }
  // 연간 — 이름이 계정 둘 이상과 맞은 줄에 고른 계정. 고를 때마다 서버가 원본을 다시 읽어 미리보기(합계 대조까지)를 다시 만든다.
  const [picks, setPicks] = useState<Record<string, string>>(initial.picks ?? {})

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

  async function pick(key: string, code: string) {
    if (!state.mapping) return
    const next = { ...picks }
    if (code) next[key] = code
    else delete next[key]
    setPicks(next)
    setBusy('고른 계정으로 미리보기를 다시 만드는 중…')
    setError(null)
    try {
      const r = await previewEcountImport(importId, { mapping: state.mapping, picks: next })
      if (r.error && !r.mapping) {
        setError(r.error)
        return
      }
      setState(r)
      setPicks(r.picks ?? next)
      if (r.error) setError(r.error)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  async function commitMonthly() {
    if (!state.mapping) return
    setBusy('서버가 원본을 다시 읽고 달마다 전표를 싣는 중…')
    setError(null)
    try {
      const r = await commitEcountImport(importId, { mapping: state.mapping })
      if (r.error) setError(r.error)
      else {
        const m = r.monthly ?? { posted: 0, corrected: 0, unchanged: 0, reversed: 0 }
        const emptied = m.reversed ? ` · 금액이 빠져 역분개 ${m.reversed}달` : ''
        setDone(
          `등록했습니다 — ${state.amounts?.year ?? ''}년 월별 손익: 새 전표 ${m.posted}달 · 정정 전표 ${m.corrected}달 · 같아서 건너뜀 ${m.unchanged}달${emptied}(ECOUNT 엑셀 · 잠정). 전표 화면에서 출처 «ECOUNT 엑셀»로 보입니다.`,
        )
      }
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  async function commitAnnual() {
    if (!state.mapping) return
    setBusy('서버가 원본을 다시 읽고 등록하는 중…')
    setError(null)
    try {
      const r = await commitEcountImport(importId, { mapping: state.mapping, picks })
      if (r.error) setError(r.error)
      else setDone(`등록했습니다 — ${state.amounts?.year ?? ''}년 연간 재무제표 ${r.lines ?? 0}줄(ECOUNT 엑셀 · 잠정). 세무사 확정 결산과는 따로 보관됩니다.`)
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
      {error && !onError ? (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}

      {confirmed && !editing && state.accounts ? (
        <EcountAccountsPreview key={JSON.stringify(state.mapping)} input={state.accounts} busy={!!busy} onCommit={(c) => void commitAccounts(c)} />
      ) : null}
      {confirmed && !editing && state.amounts ? (
        <EcountAmountsPreview
          preview={state.amounts}
          picks={picks}
          busy={!!busy}
          onPick={state.kind === 'annual' ? (k, c) => void pick(k, c) : undefined}
          onCommit={state.kind === 'annual' ? () => void commitAnnual() : state.kind === 'monthly' ? () => void commitMonthly() : undefined}
        />
      ) : null}
    </div>
  )
}
