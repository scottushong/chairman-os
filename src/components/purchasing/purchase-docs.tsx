'use client'

import { useState } from 'react'

import { downloadDocAction, uploadPurchaseDocAction, voidDocAction } from '@/app/actions/purchasing'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { formatBytes } from '@/lib/attachments/rules'
import { checkPurchaseDocFile, PURCHASE_DOC_ACCEPT, PURCHASE_DOC_FORMATS_KO } from '@/lib/purchasing/doc-rules'
import { PURCHASE_DOC_KIND_LABEL_KO, PURCHASE_DOC_KINDS, type CostSupplier, type PurchaseDoc, type PurchaseDocKind } from '@/types'

import { Alert, FIELD_INLINE, LINK_BTN, VoidButton, VoidTag } from './shared'

/**
 * 구매 첨부(견적서 · 단가표 · 송장) — 공통 첨부 부품(FileDropZone)으로 받는다. 4MB까지, 서버 액션으로.
 * 서버가 저장 **전에** 배합비 검사를 돌린다(AI 없음). 걸리면 줄도 파일도 남기지 않는다. 사진 · 스캔본은 글자를 못 읽어
 * «배합비 · 레시피가 아닙니다» 확인이 있어야 받는다. AI 요약은 없다. Vault 등급은 없다.
 */
export function PurchaseDocs({
  businessId,
  docs,
  suppliers,
  canEdit,
  canDownload = false,
  onChanged,
}: {
  businessId: string
  docs: PurchaseDoc[]
  suppliers: CostSupplier[]
  canEdit: boolean
  /** 대표만 — 원가 엔진 화면에서 내려받기는 대표 예외뿐(0068 · 감사 줄이 먼저). */
  canDownload?: boolean
  onChanged: () => void
}) {
  const [list, setList] = useState(docs)
  const [kind, setKind] = useState<PurchaseDocKind>('quote')
  const [supplierId, setSupplierId] = useState('')
  const [attested, setAttested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sName = new Map(suppliers.map((s) => [s.supplier_id, s.name]))

  async function download(d: PurchaseDoc) {
    setError(null)
    const r = await downloadDocAction(businessId, d.doc_id)
    if (r.error) return setError(r.error)
    if (r.url) {
      window.open(r.url, '_blank', 'noopener')
      return
    }
    if (r.file) {
      const bin = atob(r.file.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const href = URL.createObjectURL(new Blob([bytes], { type: r.file.mime }))
      const a = document.createElement('a')
      a.href = href
      a.download = r.file.file_name
      a.click()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    }
  }

  const visible = list.filter((d) => !d.voided_at)

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label="첨부">
      <h2 className="text-t12h font-semibold">첨부 — 견적서 · 단가표</h2>
      <p className="mt-0.5 text-t10h text-ink-muted">AI에 보내지 않습니다(요약 없음). 배합비로 보이는 파일은 저장하지 않습니다.</p>
      <Alert text={error} />
      {canEdit ? (
        <FileDropZone
          className="mt-2"
          label="구매 첨부 올리기"
          accept={PURCHASE_DOC_ACCEPT}
          hint={`${PURCHASE_DOC_FORMATS_KO}, 4MB까지`}
          camera
          check={checkPurchaseDocFile}
          upload={async (file, phase) => {
            const form = new FormData()
            form.set('file', file)
            form.set('kind', kind)
            if (supplierId) form.set('supplier_id', supplierId)
            if (attested) form.set('mix_attested', '1')
            phase('배합비 검사 중…')
            const r = await uploadPurchaseDocAction(businessId, form)
            if (r.error || !r.doc) throw new Error(r.error ?? '올리지 못했습니다.')
            const doc = r.doc
            setList((l) => [doc, ...l])
          }}
          onSettled={() => {
            setAttested(false)
            onChanged()
          }}
          extra={
            <>
              <select className={FIELD_INLINE} value={kind} onChange={(e) => setKind(e.target.value as PurchaseDocKind)} aria-label="첨부 종류">
                {PURCHASE_DOC_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PURCHASE_DOC_KIND_LABEL_KO[k]}
                  </option>
                ))}
              </select>
              <select className={FIELD_INLINE} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="공급처">
                <option value="">공급처 (선택)</option>
                {suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink-dim lg:min-h-0">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                배합비 · 레시피가 아닙니다
              </label>
            </>
          }
        />
      ) : null}
      {canEdit ? (
        <p className="mt-1 text-t10h text-ink-muted">사진 · 스캔본은 글자를 읽지 못해 검사할 수 없습니다 — 올리기 전에 «배합비 · 레시피가 아닙니다»에 체크하세요.</p>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-3 text-t12 text-ink-muted">첨부가 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft">
          {visible.map((d) => (
            <li key={d.doc_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-t12">
              <span className="min-w-0">
                {canDownload ? (
                  <button type="button" className="break-all text-left font-semibold text-ink underline-offset-2 hover:underline" onClick={() => download(d)}>
                    {d.file_name}
                  </button>
                ) : (
                  <span className="break-all font-semibold text-ink">{d.file_name}</span>
                )}
                {d.voided_at ? <VoidTag reason={d.void_reason} /> : null}
                <span className="block text-t10h text-ink-muted">
                  {PURCHASE_DOC_KIND_LABEL_KO[d.kind]}
                  {d.supplier_id ? ` · ${sName.get(d.supplier_id) ?? ''}` : ''} · {formatBytes(d.size_bytes)} · {d.created_at.slice(0, 10)} ·{' '}
                  {d.mix_checked ? '배합비 검사 통과' : '글자 없음 — 올린 사람이 «배합비 아님» 확인'}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {canDownload ? (
                  <button type="button" className={LINK_BTN} onClick={() => download(d)}>
                    내려받기
                  </button>
                ) : null}
                {canEdit ? (
                  <VoidButton
                    onVoid={async (reason) => {
                      const r = await voidDocAction(businessId, d.doc_id, reason)
                      if (!r.error) setList((l) => l.map((x) => (x.doc_id === d.doc_id ? { ...x, voided_at: new Date().toISOString(), void_reason: reason } : x)))
                      return r.error
                    }}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
