'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { beginAttachment, cancelAttachment, uploadAttachmentBytes } from '@/app/actions/attachments'
import { cancelEcountImport, previewEcountImport, startEcountImport, type EcountPreviewState } from '@/app/actions/ecount-import'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { ECOUNT_XLSX_ACCEPT, ecountBytesProblem, ecountFileProblem } from '@/lib/ecount/excel/file-rules'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImportKind } from '@/types'

import { EcountOutline } from './ecount-outline'

/**
 * ECOUNT 업로드 한 단(계정과목 · 연간 · 월별) — 파일 고르기 → 올리기 → 서버가 원본을 다시 읽은 개요.
 *
 * 올리기 세 걸음: startEcountImport(draft) → beginAttachment(entity_table='finance_imports', 등급은 서버가 «일반»으로
 * 정한다) → 바이트(live: 브라우저가 Storage로 바로 · dummy: 서버 액션). **AI 요약은 부르지 않는다.**
 * 바이트가 실패하면 첨부 줄 → 업로드 순서로 되돌린다(0050 — 끝난 업로드의 원본은 지울 수 없다).
 *
 * 대상별 미리보기(열 매핑 · 차단 · 경고)는 열 구성 확인 뒤다 — 그 전까지는 «미리보기: 열 구성 확인 후 제공».
 */

const TARGET: Record<FinanceImportKind, { source: string; target: string }> = {
  accounts: { source: 'ECOUNT 기초데이터 › 계정 내려받기', target: '계정과목 — 코드 그대로, «ECOUNT» 꼬리표' },
  annual: { source: '재무상태표 · 손익계산서(한 해)', target: '공식 결산 «ECOUNT 엑셀(잠정)» — 세무사 확정과 따로' },
  monthly: { source: '월별 손익계산서(1~12월)', target: '달마다 요약 전표 — 마감된 달은 받지 않음' },
}

export function EcountImportPanel({ businessId, kind, mode }: { businessId: string; kind: FinanceImportKind; mode: 'dummy' | 'live' }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EcountPreviewState | null>(null)

  async function upload(f: File) {
    const nameProblem = ecountFileProblem(f.name)
    if (nameProblem) throw new Error(nameProblem)
    if (f.size < 1 || f.size > ATTACHMENT_MAX_BYTES) throw new Error('20MB까지 올릴 수 있습니다.')
    // 이름만 .xlsx인 옛 형식 · 웹 표 · CSV를 올리기 전에 거른다(서버가 한 번 더 본다).
    const bytesProblem = ecountBytesProblem(new Uint8Array(await f.slice(0, 512).arrayBuffer()))
    if (bytesProblem) throw new Error(bytesProblem)

    setBusy('업로드를 시작하는 중…')
    const started = await startEcountImport(businessId, kind, f.name)
    if (started.error || !started.importId) throw new Error(started.error ?? '업로드를 시작하지 못했습니다.')
    const importId = started.importId

    try {
      setBusy(`${f.name} 올리는 중…`)
      const begun = await beginAttachment({
        entity_table: 'finance_imports',
        entity_id: importId,
        file_name: f.name,
        mime: ATTACHMENT_MIME.xlsx,
        size_bytes: f.size,
        security_class: 'Normal',
      })
      if (begun.error || !begun.id || !begun.path) throw new Error(begun.error ?? '파일을 올리지 못했습니다.')

      let upErr: string | undefined
      if (mode === 'live') {
        const { error: e } = await createSupabaseBrowserClient()
          .storage.from('attachments')
          .upload(begun.path, f, { contentType: ATTACHMENT_MIME.xlsx, upsert: false })
        upErr = e?.message
      } else {
        const fd = new FormData()
        fd.set('file', f)
        upErr = (await uploadAttachmentBytes(begun.id, fd)).error
      }
      if (upErr) {
        await cancelAttachment(begun.id)
        throw new Error(`파일을 올리지 못했습니다(${upErr}).`)
      }
    } catch (e) {
      // 원본 없는 draft를 남기지 않는다 — 첨부가 남았으면 cancelEcountImport가 먼저 지운다.
      await cancelEcountImport(importId)
      throw e
    }

    setBusy('서버가 파일을 다시 읽는 중…')
    setResult(await previewEcountImport(importId))
  }

  async function onUpload() {
    if (!file) return
    setError(null)
    setResult(null)
    try {
      await upload(file)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리지 못했습니다.')
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  const t = TARGET[kind]
  return (
    <section className="flex flex-col rounded-xl border border-line-soft bg-panel p-4" aria-label={`${FINANCE_IMPORT_KIND_LABEL_KO[kind]} 업로드`}>
      <h2 className="text-t13 font-semibold">{FINANCE_IMPORT_KIND_LABEL_KO[kind]}</h2>
      <p className="mt-1 text-t11h text-ink-dim">{t.source}</p>
      <p className="mt-0.5 text-t10h text-ink-muted">→ {t.target}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
          className="min-h-11 rounded-md border border-line bg-panel px-3 text-t11h text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50 lg:min-h-0 lg:py-1.5"
        >
          파일 고르기
        </button>
        <button
          type="button"
          disabled={!file || !!busy}
          onClick={() => void onUpload()}
          className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5"
        >
          올리기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ECOUNT_XLSX_ACCEPT}
          className="hidden"
          onChange={(e) => {
            setError(null)
            setResult(null)
            setFile(e.target.files?.[0] ?? null)
          }}
        />
      </div>
      <p className="mt-1.5 min-w-0 truncate text-t10h text-ink-muted">{file ? file.name : '.xlsx만 받습니다 · .xls · CSV는 엑셀에서 xlsx로 저장해 올리세요'}</p>

      {busy ? <p className="mt-2 text-t11 text-accent" aria-live="polite">{busy}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {error}
        </p>
      ) : null}

      {result ? (
        result.pending ? (
          <div className="mt-3 space-y-2 rounded-md border border-line-soft bg-raised/40 p-2.5">
            <p className="text-t11h font-semibold text-ink">미리보기: 열 구성 확인 후 제공</p>
            <p className="text-t10h text-ink-muted">원본을 받아 두었습니다. 아래 «진행 중»에서 취소할 수 있습니다.</p>
            {result.outline ? <EcountOutline outline={result.outline} /> : null}
          </div>
        ) : result.error ? (
          <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
            {result.error} — 원본은 «진행 중»에 남아 있습니다. 취소하고 다시 올리세요.
          </p>
        ) : null
      ) : null}
    </section>
  )
}
