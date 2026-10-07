'use client'

import { useMemo } from 'react'

import { UNIT_LABEL_KO, type EcountUnit } from '@/lib/ecount/excel/cells'
import {
  COLUMN_SPECS,
  MONTH_KEYS,
  columnLetter,
  guessColumnsAt,
  mappingProblems,
  sheetLikeFromGrid,
  type EcountMapping,
  type MappingSource,
  type SheetGrid,
  type SheetPart,
} from '@/lib/ecount/excel/mapping'

/**
 * 열 지정 화면 — 시트 · 머리글 행 · 열(계정코드 · 계정명 · 금액 · 월) · 단위 · 당월/누계 · 해를 사람이 고른다.
 *
 * ECOUNT 열 구성 캡처가 없어서 **짐작은 짐작일 뿐**이다. 화면은 짐작(또는 지난 업로드의 지정)을 미리 채워 두고,
 * 사람이 «이 열 지정으로 미리보기»를 눌러야 서버가 확정으로 적는다(summary.mapping). 판정 함수는 서버와 같은 것
 * (mappingProblems)이라 여기서 막히면 서버도 막는다.
 */

const select =
  'w-full rounded border border-line bg-panel px-2 py-1 text-t12 text-ink outline-none focus:border-accent disabled:opacity-50'

const SOURCE_NOTE: Record<MappingSource, { text: string; tone: 'info' | 'warn' }> = {
  reused: { text: '지난 업로드의 열 지정을 불러왔습니다. 머리글이 그대로인 것을 확인했습니다 — 맞으면 «이 열 지정으로 미리보기»를 누르세요.', tone: 'info' },
  guessed: { text: '머리글을 보고 열을 짐작했습니다. 짐작이므로 열마다 맞는지 확인한 뒤 «이 열 지정으로 미리보기»를 누르세요.', tone: 'warn' },
  none: { text: '머리글을 찾지 못했습니다. 시트 · 머리글 행 · 열을 직접 지정하세요.', tone: 'warn' },
  confirmed: { text: '확정한 열 지정입니다. 바꾸면 미리보기를 다시 합니다.', tone: 'info' },
}

function rowSummary(grid: SheetGrid, r: number): string {
  const cells = (grid.head[r] ?? []).filter(Boolean)
  const shown = cells.slice(0, 5).join(' · ')
  return `${r + 1}행${shown ? ` — ${shown}${cells.length > 5 ? ' …' : ''}` : ' (빈 행)'}`
}

export function EcountMappingEditor({
  grids,
  value,
  source,
  detectedUnit,
  serverProblems,
  busy,
  onChange,
  onConfirm,
}: {
  grids: SheetGrid[]
  value: EcountMapping
  source: MappingSource
  detectedUnit: EcountUnit | null
  serverProblems: string[]
  busy: boolean
  onChange: (m: EcountMapping) => void
  onConfirm: () => void
}) {
  const kind = value.kind
  const sheets = useMemo(() => grids.map(sheetLikeFromGrid), [grids])
  const problems = useMemo(() => mappingProblems(value, sheets), [value, sheets])
  const multi = kind === 'annual'
  const note = SOURCE_NOTE[source]

  function setParts(parts: SheetPart[]) {
    onChange({ ...value, parts })
  }

  function toggleSheet(name: string, on: boolean) {
    const sheet = sheets.find((s) => s.name === name)!
    // 새로 고른 시트는 머리글을 다시 짐작해 채운다(사람이 고칠 수 있다).
    const fresh = (): SheetPart => {
      let best: SheetPart = { sheet: name, headerRow: 0, columns: {} }
      let score = -1
      for (let r = 0; r < Math.min(sheet.rows.length, 30); r += 1) {
        const columns = guessColumnsAt(sheet, kind, r)
        const n = Object.keys(columns).length
        if (n > score) {
          score = n
          best = { sheet: name, headerRow: r, columns }
        }
      }
      return best
    }
    if (multi) setParts(on ? [...value.parts.filter((p) => p.sheet !== name), fresh()] : value.parts.filter((p) => p.sheet !== name))
    else if (on) setParts([value.parts.find((p) => p.sheet === name) ?? fresh()])
  }

  function setPart(i: number, part: SheetPart) {
    setParts(value.parts.map((p, j) => (j === i ? part : p)))
  }

  const unitOptions: EcountUnit[] = detectedUnit === 'million' || value.unit === 'million' ? ['won', 'thousand', 'million'] : ['won', 'thousand']

  return (
    <div className="space-y-3 rounded-md border border-line-soft bg-raised/30 p-3" aria-label="열 지정">
      <div>
        <h3 className="text-t12h font-semibold text-ink">열 지정</h3>
        <p className={`mt-1 rounded px-2 py-1 text-t11h ${note.tone === 'warn' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-ink-dim'}`}>{note.text}</p>
      </div>

      {/* 시트 */}
      <fieldset>
        <legend className="text-t11h font-semibold text-ink-dim">{multi ? '읽을 시트 (재무상태표 · 손익계산서가 따로면 둘 다)' : '읽을 시트'}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {grids.map((g) => {
            const on = value.parts.some((p) => p.sheet === g.name)
            return (
              <label key={g.name} className="flex min-h-11 items-center gap-1.5 text-t11h text-ink lg:min-h-0">
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name="ecount-sheet"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => toggleSheet(g.name, e.target.checked)}
                />
                {g.name} <span className="text-t10h text-ink-muted">({g.rowCount.toLocaleString('ko-KR')}행)</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {value.parts.map((part, i) => {
        const grid = grids.find((g) => g.name === part.sheet)
        if (!grid) return null
        return <PartEditor key={part.sheet} kind={kind} grid={grid} part={part} busy={busy} onChange={(p) => setPart(i, p)} />
      })}

      {/* 단위 · 당월/누계 · 해 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <fieldset>
          <legend className="text-t11h font-semibold text-ink-dim">금액 단위</legend>
          <div className="mt-1 flex gap-3">
            {unitOptions.map((u) => (
              <label key={u} className="flex min-h-11 items-center gap-1.5 text-t11h text-ink lg:min-h-0">
                <input type="radio" name="ecount-unit" checked={value.unit === u} disabled={busy} onChange={() => onChange({ ...value, unit: u })} />
                {UNIT_LABEL_KO[u]}
              </label>
            ))}
          </div>
          <p className="mt-0.5 text-t10h text-ink-muted">
            {detectedUnit ? `파일 머리에서 «단위: ${UNIT_LABEL_KO[detectedUnit]}»을 찾았습니다.` : '파일에 단위 표기가 없습니다 — 원인지 천원인지 확인하세요.'}
          </p>
        </fieldset>
        {kind === 'monthly' ? (
          <fieldset>
            <legend className="text-t11h font-semibold text-ink-dim">월 금액의 뜻</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink lg:min-h-0">
                <input type="radio" name="ecount-basis" checked={value.basis === 'monthly'} disabled={busy} onChange={() => onChange({ ...value, basis: 'monthly' })} />
                당월 금액
              </label>
              <label className="flex min-h-11 items-center gap-1.5 text-t11h text-ink lg:min-h-0">
                <input type="radio" name="ecount-basis" checked={value.basis === 'ytd'} disabled={busy} onChange={() => onChange({ ...value, basis: 'ytd' })} />
                1월부터 누계(YTD)
              </label>
            </div>
            <p className="mt-0.5 text-t10h text-ink-muted">누계면 앞 달 누계를 빼서 당월 금액으로 바꿉니다(1월은 그대로).</p>
          </fieldset>
        ) : null}
        {kind !== 'accounts' ? (
          <label className="text-t11h font-semibold text-ink-dim">
            몇 년도 자료인가
            <input
              className={`${select} mt-1 max-w-28`}
              inputMode="numeric"
              maxLength={4}
              placeholder="2025"
              value={value.year ?? ''}
              disabled={busy}
              onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, '').slice(0, 4) || null })}
            />
            <span className="mt-0.5 block text-t10h font-normal text-ink-muted">파일의 기간 · 월 머리글에서 짐작했습니다. 확인하세요.</span>
          </label>
        ) : null}
      </div>

      {problems.length > 0 || serverProblems.length > 0 ? (
        <ul role="alert" className="space-y-0.5 rounded-md border border-critical/40 bg-critical/10 px-2.5 py-1.5 text-t11h text-critical">
          {[...new Set([...problems, ...serverProblems])].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={busy || problems.length > 0}
        onClick={onConfirm}
        className="min-h-11 rounded-md bg-accent px-3 text-t11h font-semibold text-ink disabled:opacity-40 lg:min-h-0 lg:py-1.5"
      >
        이 열 지정으로 미리보기
      </button>
    </div>
  )
}

function PartEditor({
  kind,
  grid,
  part,
  busy,
  onChange,
}: {
  kind: EcountMapping['kind']
  grid: SheetGrid
  part: SheetPart
  busy: boolean
  onChange: (p: SheetPart) => void
}) {
  const header = grid.head[part.headerRow] ?? []
  const colOptions = Array.from({ length: grid.colCount }, (_, i) => ({ i, text: `${columnLetter(i)}열${header[i] ? ` — ${header[i]}` : ''}` }))
  const specs = COLUMN_SPECS[kind]
  const plain = specs.filter((s) => !(MONTH_KEYS as readonly string[]).includes(s.key))
  const months = specs.filter((s) => (MONTH_KEYS as readonly string[]).includes(s.key))

  function setColumn(key: string, raw: string) {
    const columns = { ...part.columns }
    if (raw === '') delete columns[key]
    else columns[key] = Number(raw)
    onChange({ ...part, columns })
  }

  function setHeaderRow(r: number) {
    // 머리글 행을 바꾸면 그 행으로 열을 다시 짐작한다 — 옛 행의 열 번호가 남으면 엉뚱한 열을 읽는다.
    onChange({ ...part, headerRow: r, columns: guessColumnsAt(sheetLikeFromGrid(grid), kind, r) })
  }

  const columnSelect = (k: string, label: string, required: boolean) => (
    <label key={k} className="text-t10h text-ink-muted">
      {label}
      {required ? <span className="text-critical"> *</span> : <span> (있으면)</span>}
      <select className={`${select} mt-0.5`} value={part.columns[k] ?? ''} disabled={busy} onChange={(e) => setColumn(k, e.target.value)}>
        <option value="">— 없음 —</option>
        {colOptions.map((o) => (
          <option key={o.i} value={o.i}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  )

  // 머리글 아래 다섯 줄 — 지정한 열이 맞는지 눈으로 본다.
  const mapped = specs.filter((s) => part.columns[s.key] !== undefined)
  const sample = grid.head.slice(part.headerRow + 1, part.headerRow + 6)

  return (
    <div className="space-y-2 rounded border border-line-soft bg-panel p-2.5">
      <p className="text-t11h font-semibold text-ink">시트 «{grid.name}»</p>
      <label className="block text-t10h text-ink-muted">
        머리글 행
        <select className={`${select} mt-0.5`} value={part.headerRow} disabled={busy} onChange={(e) => setHeaderRow(Number(e.target.value))}>
          {Array.from({ length: Math.min(grid.head.length, 30) }, (_, r) => (
            <option key={r} value={r}>
              {rowSummary(grid, r)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {plain.map((s) => columnSelect(s.key, s.label, s.required))}
      </div>
      {months.length ? (
        <div>
          <p className="text-t10h text-ink-muted">월 열 — 있는 달만 지정하세요(최소 하나)</p>
          <div className="mt-0.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {months.map((s) => columnSelect(s.key, s.label, false))}
          </div>
        </div>
      ) : null}
      {mapped.length && sample.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-t10h">
            <thead>
              <tr className="text-left text-ink-muted">
                {mapped.map((s) => (
                  <th key={s.key} className="whitespace-nowrap px-1.5 py-0.5 font-normal">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, r) => (
                <tr key={r} className="border-t border-line-soft text-ink-dim">
                  {mapped.map((s) => (
                    <td key={s.key} className="whitespace-nowrap px-1.5 py-0.5">
                      {row[part.columns[s.key]] || '·'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-0.5 text-t10h text-ink-muted">머리글 아래 {sample.length}줄 — 지정한 열이 맞는지 확인하세요.</p>
        </div>
      ) : null}
    </div>
  )
}
