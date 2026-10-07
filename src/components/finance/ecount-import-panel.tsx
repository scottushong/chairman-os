'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { beginAttachment, cancelAttachment, uploadAttachmentBytes } from '@/app/actions/attachments'
import { cancelEcountImport, previewEcountImport, startEcountImport, type EcountPreviewState } from '@/app/actions/ecount-import'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME } from '@/lib/attachments/rules'
import { ECOUNT_XLSX_ACCEPT, checkEcountFile, ecountBytesProblem, ecountFileProblem } from '@/lib/ecount/excel/file-rules'
import { limitLabel } from '@/lib/file-drop'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { FINANCE_IMPORT_KIND_LABEL_KO, type FinanceImportKind } from '@/types'

import { EcountImportFlow } from './ecount-import-flow'

/**
 * ECOUNT 업로드 한 단(계정과목 · 연간 · 월별) — 파일 고르기 → 올리기 → 서버가 원본을 다시 읽은 개요.
 *
 * 올리기 세 걸음: startEcountImport(draft) → beginAttachment(entity_table='finance_imports', 등급은 서버가 «일반»으로
 * 정한다) → 바이트(live: 브라우저가 Storage로 바로 · dummy: 서버 액션). **AI 요약은 부르지 않는다.**
 * 바이트가 실패하면 첨부 줄 → 업로드 순서로 되돌린다(0050 — 끝난 업로드의 원본은 지울 수 없다).
 *
 * 올린 뒤에는 열 지정 → 미리보기 → 등록(ecount-import-flow). 흐름이 열리면 이 단이 한 줄을 다 차지한다 — 표가 넓다.
 *
 * 받는 칸은 공통 첨부 부품(FileDropZone — 끌어다 놓기 · 고르기, 한 장만)이다. 놓자마자 이름 · 크기를 보고(checkEcountFile),
 * 바이트 앞머리는 올리기 직전에, 서버는 원본을 다시 읽어 한 번 더 본다. 사진 찍기는 없다(엑셀만 받는다).
 */

const TARGET: Record<FinanceImportKind, { source: string; target: string }> = {
  accounts: { source: 'ECOUNT 기초데이터 › 계정 내려받기', target: '계정과목 — 코드 그대로, «ECOUNT» 꼬리표' },
  annual: { source: '재무상태표 · 손익계산서(한 해)', target: '공식 결산 «ECOUNT 엑셀(잠정)» — 세무사 확정과 따로' },
  monthly: { source: '월별 손익계산서(1~12월)', target: '달마다 요약 전표 — 마감된 달은 받지 않음' },
}

export function EcountImportPanel({ businessId, kind, mode }: { businessId: string; kind: FinanceImportKind; mode: 'dummy' | 'live' }) {
  const router = useRouter()
  const [result, setResult] = useState<EcountPreviewState | null>(null)

  /** 파일 한 개 — 실패는 throw(부품이 그 파일 줄에 문구를 그린다). 진행 문구는 setBusy(= 부품의 phase). */
  async function upload(f: File, setBusy: (text: string) => void) {
    setResult(null)
    const nameProblem = ecountFileProblem(f.name)
    if (nameProblem) throw new Error(nameProblem)
    if (f.size < 1 || f.size > ATTACHMENT_MAX_BYTES) throw new Error(`${limitLabel(ATTACHMENT_MAX_BYTES)}까지 올릴 수 있습니다.`)
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
    const preview = await previewEcountImport(importId)
    setResult(preview)
    // 올라갔지만 서버가 읽지 못한 경우 — 파일 줄에도 «원본은 진행 중에 남아 있음»을 적는다(아래 문단과 같은 말).
    if (preview.error && !(preview.importId && preview.mapping)) return '올렸지만 서버가 읽지 못했습니다 — 아래 문구를 보세요.'
  }

  const t = TARGET[kind]
  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-line-soft bg-panel p-4 ${result?.mapping ? 'lg:col-span-3' : ''}`}
      aria-label={`${FINANCE_IMPORT_KIND_LABEL_KO[kind]} 업로드`}
    >
      <h2 className="text-t13 font-semibold">{FINANCE_IMPORT_KIND_LABEL_KO[kind]}</h2>
      <p className="mt-1 text-t11h text-ink-dim">{t.source}</p>
      <p className="mt-0.5 text-t10h text-ink-muted">→ {t.target}</p>

      <FileDropZone
        className="mt-3"
        label={`${FINANCE_IMPORT_KIND_LABEL_KO[kind]} 엑셀 올리기`}
        accept={ECOUNT_XLSX_ACCEPT}
        max={1}
        check={checkEcountFile}
        hint={`.xlsx 한 개 · ${limitLabel(ATTACHMENT_MAX_BYTES)}까지 · .xls · CSV는 엑셀에서 xlsx로 저장해 올리세요`}
        upload={(f, phase) => upload(f, phase)}
        onSettled={() => router.refresh()}
      />

      {result?.importId && result.mapping ? (
        <EcountImportFlow key={result.importId} initial={result} />
      ) : result?.error ? (
        <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {result.error} — 원본은 «진행 중»에 남아 있습니다. 취소하고 다시 올리세요.
        </p>
      ) : null}
    </section>
  )
}
