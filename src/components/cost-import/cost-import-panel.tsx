'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { commitCostImportAction, previewCostImportAction } from '@/app/actions/cost-import'
import { Alert, BTN, BTN_PRIMARY, FIELD, FIELD_INLINE, LABEL, LINK_BTN, Notice } from '@/components/purchasing/shared'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { COST_IMPORT_ACCEPT, COST_IMPORT_MAX_BYTES, checkCostImportFile } from '@/lib/cost-import/file-check'
import {
  IMPORT_TARGET_LABEL_KO,
  ROW_STATUS_LABEL_KO,
  type ConflictChoice,
  type CostImportPreview,
  type ImportDecisions,
  type ImportTarget,
  type PreviewRow,
  type RowStatus,
} from '@/lib/cost-import/types'
import { ecountBytesProblem } from '@/lib/ecount/excel/file-rules'
import { limitLabel } from '@/lib/file-drop'

/**
 * 원가 엔진 «엑셀로 넣기»(0068) — 넣기만 한다. 자료를 내려받는 길은 없다(빈 양식만 받는다 — 머리글 · 가짜 예시 한 줄 · 설명).
 *
 * 흐름: 파일 고르기 → 서버가 읽어 미리보기 → 칸 맞추기(사람이 확정) → 줄마다 상태(새 줄 · 같은 줄 · 충돌 · 중복 의심 · 오류)
 * → 고치기 · 고르기 → 등록. 파일은 어디에도 저장되지 않는다 — 브라우저가 File을 들고 미리보기 · 등록 때마다 다시 보낸다.
 * 겹치는 자료는 조용히 덮어쓰지 않는다: 충돌은 사람이 고르고(바꾸기는 이유 필수), 중복 의심은 «그래도 넣기»를 체크해야 등록이 풀린다.
 * 등록은 미리보기의 도장(stamp)과 함께 — 그 사이 자료가 바뀌었으면 서버가 거절하고 다시 미리보기를 부른다.
 */

type Choice = { choice: ConflictChoice; reason?: string }
type Mapping = Record<string, number | null>

const STATUS_CLASS: Record<RowStatus, string> = {
  new: 'bg-ok/15 text-ok',
  same: 'bg-raised text-ink-muted',
  conflict: 'bg-warning/15 text-warning',
  duplicate: 'bg-warning/15 text-warning',
  error: 'bg-critical/15 text-critical',
}

function conflictOptions(canBoth: boolean, canReplace: boolean): [ConflictChoice, string][] {
  const out: [ConflictChoice, string][] = [
    ['keep', canReplace ? '기존 유지' : '이 줄 버림'],
    ...(canReplace ? ([['replace', '엑셀 값으로 바꾸기']] as [ConflictChoice, string][]) : []),
  ]
  if (canBoth) out.push(['both', '둘 다 맞음'])
  return out
}

const STATUS_ORDER: RowStatus[] = ['new', 'same', 'conflict', 'duplicate', 'error']

function sameMapping(a: Mapping | undefined, b: Mapping | undefined): boolean {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const k of keys) if ((a?.[k] ?? null) !== (b?.[k] ?? null)) return false
  return true
}

export function CostImportPanel({ businessId, target, title }: { businessId: string; target: ImportTarget; title?: string }) {
  const router = useRouter()
  const label = IMPORT_TARGET_LABEL_KO[target]
  const [open, setOpen] = useState(false)
  const [zoneKey, setZoneKey] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CostImportPreview | null>(null)
  /** 서버가 읽는 데 쓰는 결정(시트 · 머리글 행 · 확정한 칸 지정 · 고친 값). */
  const [base, setBase] = useState<ImportDecisions>({})
  const [draftMapping, setDraftMapping] = useState<Mapping>({})
  const [headerRowText, setHeaderRowText] = useState('')
  /** 서버 왕복 없이 들고 있다가 등록 때 보낸다. */
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [dupOk, setDupOk] = useState<number[]>([])
  const [realBom, setRealBom] = useState(false)
  const [editing, setEditing] = useState<{ row: number; field: string; value: string } | null>(null)
  const [showSame, setShowSame] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setPreview(null)
    setBase({})
    setDraftMapping({})
    setHeaderRowText('')
    setChoices({})
    setDupOk([])
    setRealBom(false)
    setEditing(null)
    setShowSame(false)
    setError(null)
    setStale(false)
    setZoneKey((k) => k + 1)
  }

  function formFor(f: File, decisions: ImportDecisions): FormData {
    const fd = new FormData()
    fd.set('file', f)
    fd.set('businessId', businessId)
    fd.set('target', target)
    fd.set('decisions', JSON.stringify(decisions))
    return fd
  }

  /** 서버가 파일을 다시 읽어 미리보기를 만든다. 실패 문구를 돌려준다(없으면 null). */
  async function runPreview(f: File, decisions: ImportDecisions): Promise<string | null> {
    setBusy('서버가 파일을 읽어 미리보기를 만드는 중…')
    setError(null)
    setStale(false)
    try {
      const r = await previewCostImportAction(formFor(f, decisions))
      if (r.error && !r.rows) {
        setError(r.error)
        return r.error
      }
      setPreview(r)
      setBase(decisions)
      setDraftMapping(r.mapping ?? {})
      setHeaderRowText(r.headerRow ? String(r.headerRow) : '')
      if (r.error) setError(r.error)
      return null
    } catch {
      const text = '미리보기를 만들지 못했습니다. 잠시 뒤 다시 해 보세요.'
      setError(text)
      return text
    } finally {
      setBusy(null)
    }
  }

  async function pickFile(f: File) {
    setDone(null)
    const bytesProblem = ecountBytesProblem(new Uint8Array(await f.slice(0, 512).arrayBuffer()))
    if (bytesProblem) throw new Error(bytesProblem)
    setFile(f)
    setPreview(null)
    setChoices({})
    setDupOk([])
    setRealBom(false)
    setEditing(null)
    const problem = await runPreview(f, {})
    if (problem) return '읽지 못했습니다 — 아래 문구를 보세요.'
  }

  /** 시트 · 머리글 행이 바뀌면 칸 지정 · 고친 값 · 고른 것을 처음부터 다시. */
  function reread(next: ImportDecisions) {
    if (!file) return
    setChoices({})
    setDupOk([])
    setEditing(null)
    void runPreview(file, next)
  }

  function confirmMapping() {
    if (!file) return
    void runPreview(file, { ...base, mapping: draftMapping })
  }

  function saveEdit() {
    if (!file || !editing) return
    const edits = { ...(base.edits ?? {}) }
    edits[String(editing.row)] = { ...(edits[String(editing.row)] ?? {}), [editing.field]: editing.value }
    setEditing(null)
    void runPreview(file, { ...base, edits })
  }

  function undoEdit(row: number, field: string) {
    if (!file) return
    const edits = { ...(base.edits ?? {}) }
    const rowEdits = { ...(edits[String(row)] ?? {}) }
    delete rowEdits[field]
    if (Object.keys(rowEdits).length) edits[String(row)] = rowEdits
    else delete edits[String(row)]
    setEditing(null)
    void runPreview(file, { ...base, edits })
  }

  const rows = preview?.rows ?? []
  const fields = preview?.fields ?? []
  const headers = preview?.headers ?? []
  const counts = preview?.counts
  const conflicts = rows.filter((r) => r.status === 'conflict')
  const dups = rows.filter((r) => r.status === 'duplicate')
  const sameRows = rows.filter((r) => r.status === 'same').length
  const mappingChanged = !!preview && !sameMapping(draftMapping, preview.mapping)

  /** 등록이 잠긴 이유(사람 말). 비면 등록 가능. */
  const lockReasons = ((): string[] => {
    if (!preview) return []
    const out: string[] = []
    if (preview.locked) out.push(preview.locked)
    if (!preview.mappingConfirmed) out.push('칸 지정을 확인하고 «이 칸 지정으로 미리보기»를 누르세요.')
    else if (mappingChanged) out.push('칸 지정을 바꿨습니다 — «이 칸 지정으로 미리보기»를 다시 누르세요.')
    const errors = rows.filter((r) => r.status === 'error').length
    if (errors) out.push(`오류 줄 ${errors}개를 고치세요(칸을 눌러 고칠 수 있습니다).`)
    const unchosen = conflicts.filter((r) => !choices[String(r.row)]).length
    if (unchosen) out.push(`충돌 줄 ${unchosen}개의 처리를 고르세요.`)
    const noReason = conflicts.filter((r) => choices[String(r.row)]?.choice === 'replace' && !choices[String(r.row)]?.reason?.trim()).length
    if (noReason) out.push(`«엑셀 값으로 바꾸기»를 고른 줄 ${noReason}개에 이유를 적으세요.`)
    const unchecked = dups.filter((r) => !dupOk.includes(r.row)).length
    if (unchecked) out.push(`중복 의심 줄 ${unchecked}개 — 확인하고 «그래도 넣기»를 체크하거나 파일에서 빼세요.`)
    if (!out.length) {
      const toWrite =
        rows.filter((r) => r.status === 'new').length +
        dups.length +
        conflicts.filter((r) => choices[String(r.row)]?.choice !== 'keep').length
      if (toWrite === 0) out.push('넣을 줄이 없습니다.')
    }
    return [...new Set(out)]
  })()

  async function commit() {
    if (!file || !preview?.stamp || lockReasons.length || busy) return
    const conflictRows = new Set(conflicts.map((r) => String(r.row)))
    const pickedChoices: Record<string, Choice> = {}
    for (const [row, c] of Object.entries(choices)) {
      if (!conflictRows.has(row)) continue
      pickedChoices[row] = c.choice === 'replace' ? { choice: 'replace', reason: c.reason?.trim() } : { choice: c.choice }
    }
    const decisions: ImportDecisions = {
      ...base,
      choices: pickedChoices,
      dupOk: dupOk.filter((n) => dups.some((r) => r.row === n)),
      ...(target === 'bom' ? { realBom: preview.realAllowed ? realBom : false } : {}),
    }
    const fd = formFor(file, decisions)
    fd.set('stamp', preview.stamp)
    setBusy('서버가 파일을 다시 읽고 등록하는 중…')
    setError(null)
    setStale(false)
    try {
      const r = await commitCostImportAction(fd)
      if (r.stale) {
        setStale(true)
        return
      }
      if (r.error || !r.done) {
        setError(r.error ?? '등록하지 못했습니다.')
        return
      }
      setDone(`${label} — ${r.done.inserted}줄 등록 · 바꾼 줄 ${r.done.replaced} · 건너뜀 ${r.done.skipped}`)
      reset()
      setOpen(false)
      router.refresh()
    } catch {
      setError('등록하지 못했습니다. 잠시 뒤 다시 해 보세요.')
    } finally {
      setBusy(null)
    }
  }

  function setChoice(row: number, choice: ConflictChoice) {
    setChoices((c) => ({ ...c, [String(row)]: { choice, reason: c[String(row)]?.reason ?? '' } }))
    // 파일 안 겹침(바꿀 기존 줄이 없음)에서 한 줄을 버리면 짝 줄의 상태가 바뀐다 — 서버가 다시 잰다.
    const r = rows.find((x) => x.row === row)
    if (file && r && !r.canReplace) {
      const kept = { ...(base.choices ?? {}) }
      if (choice === 'keep') kept[String(row)] = { choice: 'keep' }
      else delete kept[String(row)]
      void runPreview(file, { ...base, choices: kept })
    }
  }

  function cell(r: PreviewRow, key: string) {
    const value = r.values[key] ?? ''
    const isEdited = r.edited.includes(key)
    if (editing && editing.row === r.row && editing.field === key) {
      return (
        <span className="flex min-w-40 flex-wrap items-center gap-1">
          <input
            autoFocus
            className={`${FIELD_INLINE} w-36`}
            value={editing.value}
            maxLength={500}
            aria-label={`${r.row}행 ${fields.find((f) => f.key === key)?.label ?? key} 새 값`}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdit()
              if (e.key === 'Escape') setEditing(null)
            }}
          />
          <button type="button" className={LINK_BTN} disabled={!!busy} onClick={saveEdit}>
            저장
          </button>
          <button type="button" className={LINK_BTN} onClick={() => setEditing(null)}>
            취소
          </button>
          {isEdited ? (
            <button type="button" className={LINK_BTN} disabled={!!busy} onClick={() => undoEdit(r.row, key)}>
              파일 값으로
            </button>
          ) : null}
        </span>
      )
    }
    return (
      <button
        type="button"
        disabled={!!busy}
        title={isEdited ? '파일 값에서 고침 — 눌러서 다시 고치기' : '눌러서 고치기'}
        onClick={() => setEditing({ row: r.row, field: key, value })}
        className={`min-h-11 w-full rounded px-1 text-left hover:bg-raised/60 lg:min-h-0 ${isEdited ? 'bg-warning/15 text-ink' : ''}`}
      >
        {value || <span className="text-ink-muted">—</span>}
      </button>
    )
  }

  const visibleRows = rows.filter((r) => showSame || r.status !== 'same')

  return (
    <section className="rounded-xl border border-line-soft bg-panel p-3" aria-label={title ?? `${label} 엑셀로 넣기`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-t12h font-semibold">{title ?? `${label} 엑셀로 넣기`}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={BTN}
            aria-expanded={open}
            disabled={!!busy}
            onClick={() => {
              if (open) reset()
              setOpen((v) => !v)
            }}
          >
            {open ? '닫기' : '엑셀로 넣기'}
          </button>
          <a href={`/cost-import/template/${target}`} download className={BTN}>
            빈 양식 받기
          </a>
        </div>
      </div>

      {done ? (
        <div className="mt-2">
          <Notice text={done} />
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 space-y-3">
          <p className="text-t10h text-ink-muted">
            넣기만 합니다 — 기존 자료를 조용히 덮어쓰지 않습니다. 겹치는 줄은 아래에서 고르거나 고쳐야 «등록»이 풀립니다. 파일은 저장되지 않습니다.
          </p>
          <FileDropZone
            key={zoneKey}
            label={`${label} 엑셀 고르기`}
            accept={COST_IMPORT_ACCEPT}
            max={1}
            check={checkCostImportFile}
            pickLabel="엑셀 파일 고르기"
            hint={`.xlsx 한 개 · ${limitLabel(COST_IMPORT_MAX_BYTES)}까지 · .xls · CSV는 엑셀에서 xlsx로 저장해 넣으세요`}
            upload={(f) => pickFile(f)}
            disabled={!!busy}
          />

          {busy ? (
            <p className="text-t11 text-accent" aria-live="polite">
              {busy}
            </p>
          ) : null}
          <Alert text={error} />
          {stale && file ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-t11h text-warning">
              <span>자료가 바뀌었습니다 — 다시 미리보기 하세요.</span>
              <button type="button" className={BTN} disabled={!!busy} onClick={() => void runPreview(file, base)}>
                다시 미리보기
              </button>
            </div>
          ) : null}

          {preview && file ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <p className="text-t11h text-ink-dim">
                  파일 <span className="font-semibold text-ink">{preview.fileName ?? file.name}</span>
                </p>
                {(preview.sheets?.length ?? 0) > 1 ? (
                  <label className={LABEL}>
                    시트
                    <select
                      className={`${FIELD_INLINE} mt-0.5 block`}
                      value={preview.sheet ?? ''}
                      disabled={!!busy}
                      onChange={(e) => reread({ sheet: e.target.value })}
                    >
                      {preview.sheets!.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={LABEL}>
                  머리글 행
                  <span className="mt-0.5 flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className={`${FIELD_INLINE} w-20`}
                      value={headerRowText}
                      disabled={!!busy}
                      onChange={(e) => setHeaderRowText(e.target.value)}
                    />
                    <button
                      type="button"
                      className={BTN}
                      disabled={!!busy || !(Number(headerRowText) >= 1) || Number(headerRowText) === preview.headerRow}
                      onClick={() => reread({ sheet: base.sheet ?? preview.sheet, headerRow: Math.floor(Number(headerRowText)) })}
                    >
                      이 행으로 읽기
                    </button>
                  </span>
                </label>
              </div>
              {preview.seen ? <Notice text={preview.seen} /> : null}

              <section className="rounded-lg border border-line-soft bg-raised/30 p-2.5" aria-label="칸 맞추기">
                <h3 className="text-t11h font-semibold">
                  칸 맞추기{' '}
                  <span className={`ml-1 font-normal ${preview.mappingConfirmed && !mappingChanged ? 'text-ok' : 'text-warning'}`}>
                    {preview.mappingConfirmed && !mappingChanged ? '확인됨' : '확인 전'}
                  </span>
                </h3>
                <p className="mt-0.5 text-t10h text-ink-muted">파일의 어느 열이 어느 칸인지 맞추세요. * 는 꼭 있어야 하는 칸입니다.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {fields.map((f) => (
                    <label key={f.key} className={LABEL} title={f.hint}>
                      {f.label}
                      {f.required ? <span className="text-critical"> *</span> : null}
                      <select
                        className={`${FIELD} mt-0.5`}
                        value={draftMapping[f.key] == null ? '' : String(draftMapping[f.key])}
                        disabled={!!busy}
                        onChange={(e) => setDraftMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                      >
                        <option value="">없음</option>
                        {headers.map((h, i) => (
                          <option key={i} value={String(i)}>
                            {h || `(${i + 1}번째 열 · 이름 없음)`}
                          </option>
                        ))}
                      </select>
                      {f.hint ? <span className="mt-0.5 block text-t9h text-ink-muted">{f.hint}</span> : null}
                    </label>
                  ))}
                </div>
                <button type="button" className={`${BTN} mt-2`} disabled={!!busy} onClick={confirmMapping}>
                  이 칸 지정으로 미리보기
                </button>
              </section>

              {counts ? (
                <p className="flex flex-wrap gap-1.5 text-t11h" aria-label="줄 상태 수">
                  {STATUS_ORDER.map((s) => (
                    <span key={s} className={`rounded px-1.5 py-0.5 ${STATUS_CLASS[s]}`}>
                      {ROW_STATUS_LABEL_KO[s]} <span className="tnum font-semibold">{counts[s]}</span>
                    </span>
                  ))}
                </p>
              ) : null}

              {sameRows > 0 ? (
                <button type="button" className={LINK_BTN} onClick={() => setShowSame((v) => !v)}>
                  {showSame ? `같은 줄 ${sameRows}개 숨기기` : `같은 줄 ${sameRows}개 보기(이미 있어 건너뜀)`}
                </button>
              ) : null}

              {visibleRows.length ? (
                <div className="overflow-x-auto rounded-lg border border-line-soft">
                  <table className="w-full min-w-[720px] text-t12">
                    <thead>
                      <tr className="border-b border-line-soft text-left text-t10h text-ink-muted">
                        <th className="px-2 py-1.5 font-normal">행</th>
                        {fields.map((f) => (
                          <th key={f.key} className="px-2 py-1.5 font-normal whitespace-nowrap">
                            {f.label}
                          </th>
                        ))}
                        <th className="px-2 py-1.5 font-normal">상태</th>
                        <th className="min-w-56 px-2 py-1.5 font-normal">설명 · 처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => {
                        const c = choices[String(r.row)]
                        return (
                          <tr key={r.row} className={`border-t border-line-soft align-top ${r.status === 'same' ? 'opacity-50' : ''}`}>
                            <td className="tnum px-2 py-1 text-ink-dim">{r.row}</td>
                            {fields.map((f) => (
                              <td key={f.key} className="px-1 py-1">
                                {cell(r, f.key)}
                              </td>
                            ))}
                            <td className="px-2 py-1">
                              <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-t10h ${STATUS_CLASS[r.status]}`}>{ROW_STATUS_LABEL_KO[r.status]}</span>
                            </td>
                            <td className="space-y-1 px-2 py-1 text-t11">
                              {r.message ? <p className={r.status === 'error' ? 'text-critical' : 'text-ink-dim'}>{r.message}</p> : null}
                              {r.existing ? <p className="text-ink-muted">기존: {r.existing}</p> : null}
                              {r.fileRow ? <p className="text-ink-muted">파일 {r.fileRow}행과 겹침</p> : null}
                              {r.edited.length ? <p className="text-warning">파일 값에서 고친 칸 {r.edited.length}개</p> : null}

                              {r.status === 'conflict' ? (
                                <fieldset className="space-y-1">
                                  <legend className="sr-only">{r.row}행 충돌 처리</legend>
                                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                                    {conflictOptions(r.canBoth, r.canReplace).map(([v, text]) => (
                                      <label key={v} className="flex min-h-11 items-center gap-1 lg:min-h-0">
                                        <input
                                          type="radio"
                                          name={`choice-${target}-${r.row}`}
                                          className="size-4 accent-[var(--color-accent)]"
                                          checked={c?.choice === v}
                                          disabled={!!busy}
                                          onChange={() => setChoice(r.row, v)}
                                        />
                                        {text}
                                      </label>
                                    ))}
                                  </div>
                                  {c?.choice === 'replace' ? (
                                    <>
                                      <input
                                        className={`${FIELD} ${c.reason?.trim() ? '' : 'border-critical/60'}`}
                                        value={c.reason ?? ''}
                                        maxLength={300}
                                        placeholder="이유(필수) — 감사에 남습니다"
                                        aria-label={`${r.row}행 바꾸는 이유`}
                                        disabled={!!busy}
                                        onChange={(e) => setChoices((all) => ({ ...all, [String(r.row)]: { choice: 'replace', reason: e.target.value } }))}
                                      />
                                      {r.othersRow ? <p className="text-warning">다른 사람이 넣은 줄입니다 — 바꾸면 그 사람에게 알림이 갑니다.</p> : null}
                                    </>
                                  ) : null}
                                </fieldset>
                              ) : null}

                              {r.status === 'duplicate' ? (
                                <label className="flex min-h-11 items-center gap-1 lg:min-h-0">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-[var(--color-accent)]"
                                    checked={dupOk.includes(r.row)}
                                    disabled={!!busy}
                                    onChange={(e) => setDupOk((l) => (e.target.checked ? [...l, r.row] : l.filter((n) => n !== r.row)))}
                                  />
                                  그래도 넣기
                                </label>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : rows.length ? (
                <p className="text-t11h text-ink-dim">모든 줄이 이미 있는 것과 같습니다 — 넣을 것이 없습니다.</p>
              ) : (
                <p className="text-t11h text-ink-dim">읽은 줄이 없습니다. 시트 · 머리글 행을 확인하세요.</p>
              )}

              {target === 'bom' ? (
                preview.realAllowed ? (
                  <label className="flex min-h-11 items-center gap-1.5 text-t12 lg:min-h-0">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-accent)]"
                      checked={realBom}
                      disabled={!!busy}
                      onChange={(e) => setRealBom(e.target.checked)}
                    />
                    진짜 BOM으로 넣기
                  </label>
                ) : (
                  <p className="text-t11h text-ink-dim">진짜 BOM 받기가 꺼져 있어 가짜 BOM으로만 들어갑니다.</p>
                )
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2">
                <button type="button" className={BTN_PRIMARY} disabled={!!busy || lockReasons.length > 0 || !preview.stamp} onClick={() => void commit()}>
                  {busy ? '처리 중…' : '등록'}
                </button>
                <button type="button" className={LINK_BTN} disabled={!!busy} onClick={reset}>
                  처음부터
                </button>
              </div>
              {lockReasons.length ? (
                <ul className="list-inside list-disc space-y-0.5 text-t11h text-ink-dim" aria-label="등록이 잠긴 이유">
                  {lockReasons.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
