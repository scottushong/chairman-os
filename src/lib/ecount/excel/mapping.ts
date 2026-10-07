import type { FinanceImportKind } from '@/types'

import { cellText, type EcountCell, type EcountUnit } from './cells'
import { detectPeriod, findUnit, fullYearOf, normalizeLabel } from './detect'

/**
 * ECOUNT 엑셀 열 지정(매핑) — 순수 함수. **브라우저와 서버가 같이 본다**(exceljs · node:crypto를 끌어오지 않는다).
 *
 * ECOUNT 화면 캡처(열 구성)가 없어서 열은 **사람이 지정한다**. 여기는:
 *   1. 흔한 ECOUNT 머리글(계정코드 · 계정명 · 과목 · 당기 · 1월 · 2025-01 · 202501 …)로 **짐작만** 한다
 *   2. 회사마다 지난 업로드의 지정(finance_imports.summary.mapping)을 머리글이 그대로면 다시 쓴다
 *   3. 지정의 모양 · 범위를 판정한다 — 화면이 보낸 값도, summary(jsonb · 만든 사람이 고칠 수 있는 칸)도 믿지 않는다
 * 짐작은 짐작이다 — **사람이 «이 열 지정으로 미리보기»를 누르기 전에는 등록하지 않는다**(서버가 summary의
 * 확정 지정과 등록 때 보낸 지정이 같은지 본다).
 */

/** 월 열 열두 개 — 1월~12월. */
export const MONTH_KEYS = ['m01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12'] as const
export type MonthKey = (typeof MONTH_KEYS)[number]

export interface ColumnSpec {
  key: string
  label: string
  required: boolean
  /** 이 열로 짐작할 머리글(normalizeLabel 뒤 정확히 같은 것). 월 열은 monthOfLabel이 따로 본다. */
  guesses: readonly string[]
}

const NAME_GUESSES = ['과목명', '과목', '계정과목', '계정과목명', '계정명', '항목', '계정']
const CODE_GUESSES = ['계정코드', '코드', '계정번호', '과목코드', 'code', 'CODE']

export const COLUMN_SPECS: Record<FinanceImportKind, readonly ColumnSpec[]> = {
  accounts: [
    { key: 'code', label: '계정코드', required: true, guesses: CODE_GUESSES },
    { key: 'name', label: '계정명', required: true, guesses: ['계정명', '계정과목명', '계정과목', '과목명', '과목', '계정'] },
    { key: 'group', label: '구분', required: false, guesses: ['구분', '계정구분', '계정분류', '분류', '대분류', '계정유형', '유형'] },
    { key: 'use', label: '사용여부', required: false, guesses: ['사용여부', '사용', '사용구분', '사용유무'] },
  ],
  annual: [
    { key: 'name', label: '과목명', required: true, guesses: NAME_GUESSES },
    { key: 'code', label: '계정코드', required: false, guesses: CODE_GUESSES },
    { key: 'amount', label: '당기 금액', required: true, guesses: ['당기', '당기금액', '당기말', '당기말금액', '금액', '합계', '잔액'] },
  ],
  monthly: [
    { key: 'name', label: '과목명', required: true, guesses: NAME_GUESSES },
    { key: 'code', label: '계정코드', required: false, guesses: CODE_GUESSES },
    ...MONTH_KEYS.map((k, i) => ({ key: k, label: `${i + 1}월`, required: false, guesses: [] as string[] })),
    { key: 'total', label: '합계 열', required: false, guesses: ['합계', '계', '연간합계', '총계', '누계'] },
  ],
}

/** 한 시트를 어떻게 읽는가. columns는 열 이름 → 0부터 센 열(지정한 것만). */
export interface SheetPart {
  sheet: string
  /** 0부터 센 머리글 행 */
  headerRow: number
  columns: Record<string, number>
}

/** 당월 발생액 / 1월부터의 누계(YTD). 월별만. */
export type MonthlyBasis = 'monthly' | 'ytd'

export interface EcountMapping {
  kind: FinanceImportKind
  /** 읽을 시트들. 계정과목 · 월별은 하나, 연간은 재무상태표 · 손익계산서가 시트 둘일 수 있다. */
  parts: SheetPart[]
  unit: EcountUnit
  /** 월별만 — 그 밖은 null */
  basis: MonthlyBasis | null
  /** 연간 · 월별의 해(YYYY). 파일에서 짐작하고 사람이 확인한다. 계정과목은 null */
  year: string | null
  /** 지정 당시 머리글(정규화) — 다음 업로드에서 «같은 모양의 파일인가»를 잰다. parts와 같은 순서 */
  labels: Record<string, string>[]
}

export type MappingSource = 'reused' | 'guessed' | 'confirmed' | 'none'

// ---------------------------------------------------------------- 월 머리글

/**
 * 월 머리글 — «1월» · «01월» · «2025-01» · «2025.1» · «202501» · «2025년 1월» · 날짜 칸(2025-01-01) ·
 * «1월 누계»(누계 꼬리는 ytd 힌트). 아니면 null.
 */
export function monthOfLabel(label: string): { month: number; year: string | null; ytd: boolean } | null {
  const t = normalizeLabel(label)
  if (!t) return null
  const tail = /(누계|누적)$/.test(t)
  const s = t.replace(/(누계|누적|당월|발생|발생액|실적|금액)$/, '')
  let m: RegExpExecArray | null
  let month: number | null = null
  let year: string | null = null
  if ((m = /^(\d{1,2})월$/.exec(s))) month = Number(m[1])
  else if ((m = /^(\d{4})(?:[-./]|년)(\d{1,2})(?:월)?(?:[-./]\d{1,2})?$/.exec(s))) {
    year = m[1]
    month = Number(m[2])
  } else if ((m = /^(20\d{2})(0[1-9]|1[0-2])$/.exec(s))) {
    year = m[1]
    month = Number(m[2])
  }
  if (month === null || month < 1 || month > 12) return null
  return { month, year, ytd: tail }
}

// ---------------------------------------------------------------- 짐작

export interface SheetLike {
  name: string
  rows: EcountCell[][]
  colCount: number
}

const HEADER_SCAN_ROWS = 30

function rowLabels(sheet: SheetLike, row: number): string[] {
  return (sheet.rows[row] ?? []).map((c) => normalizeLabel(cellText(c)))
}

/** 한 행을 머리글로 보고 열을 짐작한다. 한 열은 한 이름에만 — 앞선 spec이 먼저 가져간다. */
function guessColumns(labels: string[], kind: FinanceImportKind): { columns: Record<string, number>; ytdHint: boolean; years: Set<string> } {
  const columns: Record<string, number> = {}
  const used = new Set<number>()
  let ytdHint = false
  const years = new Set<string>()
  if (kind === 'monthly') {
    labels.forEach((l, i) => {
      const mo = monthOfLabel(l)
      if (!mo) return
      const key = MONTH_KEYS[mo.month - 1]
      if (columns[key] !== undefined) return
      columns[key] = i
      used.add(i)
      if (mo.ytd) ytdHint = true
      if (mo.year) years.add(mo.year)
    })
  }
  for (const spec of COLUMN_SPECS[kind]) {
    if (spec.guesses.length === 0 || columns[spec.key] !== undefined) continue
    const names = new Set(spec.guesses.map(normalizeLabel))
    const i = labels.findIndex((l, idx) => !used.has(idx) && l !== '' && names.has(l))
    if (i >= 0) {
      columns[spec.key] = i
      used.add(i)
    }
  }
  return { columns, ytdHint, years }
}

function requiredOk(kind: FinanceImportKind, columns: Record<string, number>): boolean {
  const req = COLUMN_SPECS[kind].filter((s) => s.required).every((s) => columns[s.key] !== undefined)
  if (!req) return false
  return kind !== 'monthly' || MONTH_KEYS.some((k) => columns[k] !== undefined)
}

/** 시트 하나에서 가장 그럴듯한 머리글 행. 필수 열이 다 맞는 행 중 맞은 열이 가장 많은 첫 행. */
export function guessPart(sheet: SheetLike, kind: FinanceImportKind): { part: SheetPart; score: number; ytdHint: boolean; years: Set<string> } | null {
  let best: { part: SheetPart; score: number; ytdHint: boolean; years: Set<string> } | null = null
  for (let r = 0; r < Math.min(sheet.rows.length, HEADER_SCAN_ROWS); r += 1) {
    const g = guessColumns(rowLabels(sheet, r), kind)
    if (!requiredOk(kind, g.columns)) continue
    const score = Object.keys(g.columns).length
    if (!best || score > best.score) best = { part: { sheet: sheet.name, headerRow: r, columns: g.columns }, score, ytdHint: g.ytdHint, years: g.years }
  }
  return best
}

/** 시트 머리(머리글 위)의 글에서 «누계» · «누적»이 보이면 ytd 힌트. */
function headTextHasYtd(sheet: SheetLike, headerRow: number): boolean {
  for (let r = 0; r < headerRow; r += 1) {
    if ((sheet.rows[r] ?? []).some((c) => /누계|누적/.test(normalizeLabel(cellText(c))))) return true
  }
  return false
}

function headYear(sheet: SheetLike, maxRows = 15): string | null {
  for (let r = 0; r < Math.min(sheet.rows.length, maxRows); r += 1) {
    for (const c of sheet.rows[r] ?? []) {
      const p = detectPeriod(cellText(c))
      if (p) return fullYearOf(p) ?? p.from.slice(0, 4)
    }
  }
  return null
}

export interface MappingGuess {
  mapping: EcountMapping
  /** 파일 머리에서 찾은 단위(없으면 null — 화면이 «단위 표기 없음, 확인하세요») */
  detectedUnit: EcountUnit | null
  /** 머리글을 하나도 못 찾았으면 false(사람이 처음부터 지정) */
  found: boolean
}

/**
 * 머리글 짐작. 연간은 머리글이 맞는 시트를 전부(재무상태표 · 손익계산서), 나머지는 가장 잘 맞는 시트 하나.
 * 단위는 고른 시트 머리의 «(단위 : 천원)»에서, 없으면 원으로 두고 detectedUnit=null.
 */
export function guessMapping(sheets: SheetLike[], kind: FinanceImportKind): MappingGuess {
  const guesses = sheets.map((s) => guessPart(s, kind)).filter((g): g is NonNullable<typeof g> => g !== null)
  const chosen = kind === 'annual' ? guesses : guesses.sort((a, b) => b.score - a.score).slice(0, 1)
  const parts = chosen.map((g) => g.part)
  const sheetOf = (name: string) => sheets.find((s) => s.name === name)!
  let detectedUnit: EcountUnit | null = null
  for (const p of parts.length ? parts : []) {
    detectedUnit = findUnit(sheetOf(p.sheet).rows)?.value ?? null
    if (detectedUnit) break
  }
  let basis: MonthlyBasis | null = null
  let year: string | null = null
  if (kind === 'monthly') {
    const g = chosen[0]
    basis = g && (g.ytdHint || headTextHasYtd(sheetOf(g.part.sheet), g.part.headerRow)) ? 'ytd' : 'monthly'
    year = g && g.years.size === 1 ? [...g.years][0] : null
  }
  if (kind !== 'accounts' && !year) {
    for (const p of parts) {
      year = headYear(sheetOf(p.sheet))
      if (year) break
    }
  }
  const mapping: EcountMapping = { kind, parts, unit: detectedUnit ?? 'won', basis, year, labels: [] }
  return { mapping: withLabels(mapping, sheets), detectedUnit, found: parts.length > 0 }
}

/** 지정한 열의 머리글(정규화)을 적는다 — 다음 업로드에서 같은 모양인지 잴 때 쓴다. */
export function withLabels(mapping: EcountMapping, sheets: SheetLike[]): EcountMapping {
  const labels = mapping.parts.map((p) => {
    const sheet = sheets.find((s) => s.name === p.sheet)
    const row = sheet ? rowLabels(sheet, p.headerRow) : []
    return Object.fromEntries(Object.entries(p.columns).map(([k, c]) => [k, row[c] ?? '']))
  })
  return { ...mapping, labels }
}

/**
 * 지난 업로드의 지정을 이번 파일에 다시 쓸 수 있는가 — 시트 이름 · 머리글 행 · 지정한 열의 머리글이 **전부** 같을 때만.
 * 시트가 하나뿐인 파일끼리는 시트 이름이 달라도 된다(ECOUNT가 시트 이름에 날짜를 붙이는 경우). 아니면 null.
 */
export function reuseMapping(saved: EcountMapping, sheets: SheetLike[]): EcountMapping | null {
  if (saved.parts.length === 0 || saved.labels.length !== saved.parts.length) return null
  const parts: SheetPart[] = []
  for (let i = 0; i < saved.parts.length; i += 1) {
    const p = saved.parts[i]
    let sheet = sheets.find((s) => s.name === p.sheet)
    if (!sheet && saved.parts.length === 1 && sheets.length === 1) sheet = sheets[0]
    if (!sheet || p.headerRow >= sheet.rows.length) return null
    const row = rowLabels(sheet, p.headerRow)
    for (const [k, c] of Object.entries(p.columns)) {
      if ((row[c] ?? '') !== (saved.labels[i][k] ?? '\u0000') || (row[c] ?? '') === '') return null
    }
    parts.push({ ...p, sheet: sheet.name })
  }
  return withLabels({ ...saved, parts }, sheets)
}

// ---------------------------------------------------------------- 판정

/** 지정이 이 파일에서 읽을 수 있는 모양인가. 문제 문장 목록(빈 배열이면 통과). */
export function mappingProblems(mapping: EcountMapping, sheets: SheetLike[]): string[] {
  const out: string[] = []
  const { kind } = mapping
  if (mapping.parts.length === 0) return ['읽을 시트를 고르세요.']
  if (kind !== 'annual' && mapping.parts.length > 1) out.push('이 종류는 시트 하나만 읽습니다.')
  const seen = new Set<string>()
  for (const p of mapping.parts) {
    const sheet = sheets.find((s) => s.name === p.sheet)
    if (!sheet) {
      out.push(`시트 «${p.sheet}»가 파일에 없습니다.`)
      continue
    }
    if (seen.has(p.sheet)) out.push(`시트 «${p.sheet}»를 두 번 골랐습니다.`)
    seen.add(p.sheet)
    if (!Number.isInteger(p.headerRow) || p.headerRow < 0 || p.headerRow >= sheet.rows.length) {
      out.push(`«${p.sheet}»의 머리글 행이 시트 밖입니다.`)
      continue
    }
    const where = mapping.parts.length > 1 ? `«${p.sheet}»: ` : ''
    for (const spec of COLUMN_SPECS[kind]) {
      if (spec.required && p.columns[spec.key] === undefined) out.push(`${where}«${spec.label}» 열을 지정하세요.`)
    }
    if (kind === 'monthly' && !MONTH_KEYS.some((k) => p.columns[k] !== undefined)) out.push(`${where}월 열을 하나 이상 지정하세요.`)
    const used = new Map<number, string>()
    for (const [k, c] of Object.entries(p.columns)) {
      const label = COLUMN_SPECS[kind].find((s) => s.key === k)?.label ?? k
      if (!Number.isInteger(c) || c < 0 || c >= sheet.colCount) out.push(`${where}«${label}» 열이 시트 밖입니다.`)
      else if (used.has(c)) out.push(`${where}«${used.get(c)}»와 «${label}»에 같은 열을 지정했습니다.`)
      else used.set(c, label)
    }
  }
  if (kind === 'monthly' && mapping.basis !== 'monthly' && mapping.basis !== 'ytd') out.push('당월 금액인지 누계인지 고르세요.')
  if (kind !== 'accounts' && (!mapping.year || !/^20\d{2}$/.test(mapping.year))) out.push('몇 년도 자료인지 확인하세요(예: 2025).')
  return out
}

const UNITS: readonly EcountUnit[] = ['won', 'thousand', 'million']

/**
 * 믿지 않는 값(화면이 보낸 것 · summary jsonb)을 지정으로. 모양이 하나라도 틀리면 null.
 * 열 이름은 그 종류의 spec에 있는 것만 받는다.
 */
export function parseMapping(raw: unknown, kind: FinanceImportKind): EcountMapping | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.kind !== kind || !Array.isArray(o.parts) || o.parts.length > 20) return null
  if (!UNITS.includes(o.unit as EcountUnit)) return null
  const basis = o.basis === null || o.basis === undefined ? null : o.basis
  if (kind === 'monthly' ? basis !== 'monthly' && basis !== 'ytd' : basis !== null) return null
  const year = o.year === null || o.year === undefined ? null : o.year
  if (year !== null && (typeof year !== 'string' || !/^\d{4}$/.test(year))) return null
  const keys = new Set(COLUMN_SPECS[kind].map((s) => s.key))
  const parts: SheetPart[] = []
  for (const p of o.parts as unknown[]) {
    if (!p || typeof p !== 'object') return null
    const q = p as Record<string, unknown>
    if (typeof q.sheet !== 'string' || q.sheet.length > 100 || !Number.isInteger(q.headerRow)) return null
    if (!q.columns || typeof q.columns !== 'object') return null
    const columns: Record<string, number> = {}
    for (const [k, c] of Object.entries(q.columns as Record<string, unknown>)) {
      if (!keys.has(k) || !Number.isInteger(c) || (c as number) < 0 || (c as number) > 1000) return null
      columns[k] = c as number
    }
    parts.push({ sheet: q.sheet, headerRow: q.headerRow as number, columns })
  }
  const labels: Record<string, string>[] = []
  if (Array.isArray(o.labels)) {
    for (const l of o.labels as unknown[]) {
      if (!l || typeof l !== 'object') return null
      const rec: Record<string, string> = {}
      for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
        if (!keys.has(k) || typeof v !== 'string') return null
        rec[k] = v.slice(0, 100)
      }
      labels.push(rec)
    }
  }
  return { kind, parts, unit: o.unit as EcountUnit, basis: basis as MonthlyBasis | null, year: year as string | null, labels }
}

/** 지정 둘이 같은가(머리글 기록은 빼고 — 읽는 방법만 본다). 등록이 «미리보기에서 확인한 그 지정»인지 잰다. */
export function sameMapping(a: EcountMapping, b: EcountMapping): boolean {
  const canon = (m: EcountMapping) =>
    JSON.stringify({
      kind: m.kind,
      unit: m.unit,
      basis: m.basis,
      year: m.year,
      parts: m.parts.map((p) => ({
        sheet: p.sheet,
        headerRow: p.headerRow,
        columns: Object.keys(p.columns).sort().map((k) => [k, p.columns[k]]),
      })),
    })
  return canon(a) === canon(b)
}

// ---------------------------------------------------------------- 화면용 격자

export interface SheetGrid {
  name: string
  colCount: number
  rowCount: number
  /** 위 30행의 글(칸마다 40자까지) — 머리글 행 · 열을 고르는 화면이 쓴다 */
  head: string[][]
}

/** 열 이름(A, B, … Z, AA …) */
export function columnLetter(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function sheetGrids(sheets: SheetLike[]): SheetGrid[] {
  return sheets.map((s) => ({
    name: s.name.slice(0, 100),
    colCount: s.colCount,
    rowCount: s.rows.length,
    head: s.rows.slice(0, HEADER_SCAN_ROWS).map((r) => r.map((c) => cellText(c).slice(0, 40))),
  }))
}

/** 화면 격자를 짐작 · 판정 함수가 읽는 모양으로(글만 — 머리글 짐작에는 충분하다). */
export function sheetLikeFromGrid(grid: SheetGrid): SheetLike {
  const rows: EcountCell[][] = grid.head.map((r) => r.map((t) => (t ? { t: 'text', v: t } : { t: 'empty' })))
  // 위 30행만 실었다 — 행 수는 원래 값으로 맞춘다(머리글 행 판정이 «시트 밖»을 잘못 말하지 않게).
  while (rows.length < grid.rowCount) rows.push([])
  return { name: grid.name, rows, colCount: grid.colCount }
}

/** 사람이 머리글 행을 바꿨을 때 그 행으로 열을 다시 짐작한다. */
export function guessColumnsAt(sheet: SheetLike, kind: FinanceImportKind, headerRow: number): Record<string, number> {
  return guessColumns(rowLabels(sheet, headerRow), kind).columns
}
