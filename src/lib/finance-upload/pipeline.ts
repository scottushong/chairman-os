import { createHash } from 'node:crypto'

import { cellText, EMPTY_CELL, type EcountCell } from '@/lib/ecount/excel/cells'
import { detectPeriod, normalizeLabel } from '@/lib/ecount/excel/detect'
import type { EcountSheet } from '@/lib/ecount/excel/workbook'

import { KIND_SPECS, kindSpec, type KindSpec, type UploadKind } from './kinds'

/**
 * «회계 · 재무 자료 올리기» v2 — 파일 한 장의 처리(2b ~ 2f). **AI 없이 도는 부분 전부**가 여기 있다(순수 함수 — check:finance-upload가 잰다).
 *
 *   b 버리기   AI · 저장 전에 코드가 먼저: ④ 제조지시의 원료 투입 줄 · ⑥ 급여의 이름 · 주민번호 · 계좌 칸 · 카드번호(뒤 4자리만)
 *   c 분류     학습(시트 모양) → 코드 낱말 점수 → (모자라면) AI(ai.ts — 칸 대응 JSON만 받는다). 여기는 앞의 둘과 합치기.
 *   d 읽기     칸 대응대로 코드가 숫자를 읽는다(AI가 숫자를 만들지 않는다).
 *   e 검증     합계 줄 · 날짜 · 통화 · 음수 · 기간.
 *   f 넣기 판정 믿음 «높음» + 검증 통과 + 겹침 없음 + 마감 아님 → 자동. 아니면 미리보기.
 */

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface Classification {
  kind: UploadKind | 'unknown'
  confidence: Confidence
  /** 0부터. 머리글 줄. */
  headerRow: number
  /** 칸 이름 → 열 번호(0부터) */
  columns: Record<string, number>
  reason: string
  source: 'learned' | 'code' | 'ai'
}

/* ───────────────────────── b. 버리기 ───────────────────────── */

const PERSON_COLS = /성명|이름|주민|주민번호|주민등록|계좌|은행|생년|주소|연락처|휴대폰|전화/
const MATERIAL_ROW = /투입|원료|원재료|부재료|자재|배합|소요량|bom/i
const CARD_RE = /\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g
const PRODUCTION_HINT = /제조지시|작업지시|생산실적|생산지시/
const PAYROLL_HINT = /급여|임금|상여/

export interface Scrubbed {
  sheet: EcountSheet
  /** 버린 것(화면 · 감사 — 내용은 담지 않는다) */
  dropped: { materialRows: number; personCols: number; cardNumbers: number }
}

function sheetText(sheet: EcountSheet, rows = 8): string {
  return [sheet.name, ...sheet.rows.slice(0, rows).map((r) => r.map(cellText).join(' '))].join(' ')
}

/**
 * 시트 하나를 AI · 저장 전에 닦는다. 종류를 아직 모르므로 **모양으로** 판단한다:
 *   제조지시 모양(시트명 · 제목 낱말)이면 원료 줄(투입 · 원료 · 자재 · 배합 낱말이 든 줄)을 통째로 버린다.
 *   급여 모양이거나 머리글에 이름 · 주민 · 계좌 칸이 있으면 그 열을 비운다(사번은 남긴다).
 *   카드번호 16자리는 어느 시트든 뒤 4자리만.
 */
export function scrubSheet(sheet: EcountSheet): Scrubbed {
  const text = sheetText(sheet)
  const production = PRODUCTION_HINT.test(normalizeLabel(text))
  const payrollish = PAYROLL_HINT.test(normalizeLabel(text))
  let materialRows = 0
  let cardNumbers = 0
  const header = findHeader(sheet.rows)
  const personCols = new Set<number>()
  // 머리글 줄의 이름 · 주민 · 계좌 칸을 비운다 — 급여 모양이면 이름 · 연락처까지, 아니면 주민 · 계좌만(카드 · 판촉의 담당자 이름은 남긴다).
  // 머리글 줄만 본다: 자료 줄의 «가짜 은행»(대출 금융기관)을 칸 이름으로 읽으면 금융기관 칸이 통째로 비워진다.
  if (header) {
    sheet.rows[header.row].forEach((c, i) => {
      const t = normalizeLabel(cellText(c))
      if (t && t.length <= 12 && PERSON_COLS.test(t) && (payrollish || /주민|계좌번호|계좌|은행계좌/.test(t)) && !/금융기관/.test(t)) personCols.add(i)
    })
  }
  const rows: EcountCell[][] = []
  sheet.rows.forEach((row, r) => {
    const line = row.map(cellText).join(' ')
    if (production && r > (header?.row ?? 0) && MATERIAL_ROW.test(line)) {
      materialRows += 1
      return
    }
    rows.push(
      row.map((c, i) => {
        if (personCols.has(i) && r > (header?.row ?? -1)) return EMPTY_CELL
        if (c.t === 'text' && CARD_RE.test(c.v)) {
          CARD_RE.lastIndex = 0
          cardNumbers += 1
          return { t: 'text', v: c.v.replace(CARD_RE, (_m, _a, _b, _c, d) => `****-****-****-${d}`) }
        }
        CARD_RE.lastIndex = 0
        return c
      }),
    )
  })
  return { sheet: { ...sheet, rows }, dropped: { materialRows, personCols: personCols.size, cardNumbers } }
}

/* ───────────────────────── c. 분류(코드) ───────────────────────── */

const SKIP_LINE = /회사명|출력일|출력시간|인쇄|page|페이지|^\s*\d{4}\/\d{2}\/\d{2}\s*(오전|오후)/i

/** 머리글 줄 — 제목 · 출력 시각 · 회사명 줄을 건너뛰고 낱말(어느 종류든 칸 이름)이 가장 많이 모인 줄. */
export function findHeader(rows: EcountCell[][], maxRows = 30): { row: number; hits: number } | null {
  const words = [...new Set(KIND_SPECS.flatMap((k) => k.fields.flatMap((f) => f.keywords)).concat(['일자', '적요', '잔액', '합계']))]
  let best: { row: number; hits: number } | null = null
  for (let r = 0; r < Math.min(maxRows, rows.length); r += 1) {
    const cells = rows[r].map((c) => normalizeLabel(cellText(c))).filter(Boolean)
    if (cells.length < 2) continue
    if (SKIP_LINE.test(cells.join(' '))) continue
    const hits = cells.filter((t) => t.length <= 20 && words.some((w) => t.toLowerCase().includes(normalizeLabel(w).toLowerCase()))).length
    if (hits >= 2 && (!best || hits > best.hits)) best = { row: r, hits }
  }
  return best
}

/** 그 종류의 칸을 머리글 줄에서 찾는다 — 낱말 목록 앞쪽(더 구체적인 말)이 이긴다, 한 열은 한 칸만. */
export function mapColumns(spec: KindSpec, headerCells: EcountCell[]): Record<string, number> {
  const labels = headerCells.map((c) => normalizeLabel(cellText(c)).toLowerCase())
  const used = new Set<number>()
  const out: Record<string, number> = {}
  // 두 번 돈다: 먼저 글이 똑같은 칸(«AMOUNT» = amount · «원화금액» = amount_krw), 그다음 포함(«공급가액» ⊃ «가액»).
  // 한 번에 포함으로 찾으면 넓은 낱말(«금액»)이 더 구체적인 칸(«원화금액»)을 먼저 가져간다.
  for (const exact of [true, false]) {
    for (const field of spec.fields) {
      if (field.key in out) continue
      for (const kw of field.keywords) {
        const k = normalizeLabel(kw).toLowerCase()
        const i = labels.findIndex((l, idx) => !used.has(idx) && l !== '' && (exact ? l === k : l.includes(k)))
        if (i >= 0) {
          out[field.key] = i
          used.add(i)
          break
        }
      }
    }
  }
  return out
}

/** 시트 모양 서명(분류 학습 키) — 시트명 · 머리글 줄 글 · 회사. 숫자는 넣지 않는다. */
export function shapeSignature(businessId: string, sheet: EcountSheet, headerRow: number): string {
  const head = (sheet.rows[headerRow] ?? []).map((c) => normalizeLabel(cellText(c))).join('|')
  return createHash('sha256').update(`${businessId}\n${normalizeLabel(sheet.name)}\n${head}`).digest('hex').slice(0, 32)
}

export function classifyByCode(sheet: EcountSheet): Classification {
  const header = findHeader(sheet.rows)
  const title = normalizeLabel(sheetText(sheet, 5))
  const name = normalizeLabel(sheet.name)
  const scored = KIND_SPECS.map((spec) => {
    const hint = spec.hints.some((h) => name.includes(normalizeLabel(h))) ? 3 : spec.hints.some((h) => title.includes(normalizeLabel(h))) ? 2 : 0
    const cols = header ? mapColumns(spec, sheet.rows[header.row]) : {}
    const required = spec.fields.filter((f) => f.required).every((f) => f.key in cols)
    const matched = Object.keys(cols).length
    return { spec, cols, score: hint * 2 + matched + (required ? 2 : -3), hint, required, matched }
  }).sort((a, b) => b.score - a.score)
  const [a, b] = scored
  if (!header || !a || a.score <= 0) {
    return { kind: 'unknown', confidence: 'none', headerRow: header?.row ?? 0, columns: {}, reason: '머리글 · 종류 낱말을 찾지 못했습니다.', source: 'code' }
  }
  const margin = a.score - (b?.score ?? 0)
  const confidence: Confidence =
    a.hint > 0 && a.required && a.matched >= Math.min(3, a.spec.fields.length) && margin >= 2 ? 'high' : a.required && margin >= 1 ? 'medium' : 'low'
  return {
    kind: a.spec.kind,
    confidence,
    headerRow: header.row,
    columns: a.cols,
    reason: `${a.hint ? '시트명 · 제목에 «' + a.spec.hints.find((h) => title.includes(normalizeLabel(h)) || name.includes(normalizeLabel(h))) + '»' : '종류 낱말 없음'} · 칸 ${a.matched}개(${a.spec.fields.length}개 중)`,
    source: 'code',
  }
}

/** AI 결과(JSON)를 코드 결과와 합친다. 같은 종류면 높음, 다르면 낮음(사람이 고른다). AI 칸 대응은 머리글 범위 안의 숫자만. */
export function mergeAi(code: Classification, ai: { kind: string; confidence: Confidence; header_row: number; columns: Record<string, number>; reason: string } | null, colCount: number): Classification {
  if (!ai) return code
  if (code.kind === 'unknown' && ai.kind === 'unknown') {
    return { ...code, confidence: 'none', reason: `코드 · AI 모두 종류를 모릅니다(${ai.reason.slice(0, 80)}) — 종류를 골라 주세요.`, source: 'ai' }
  }
  const kind = KIND_SPECS.some((k) => k.kind === ai.kind) ? (ai.kind as UploadKind) : 'unknown'
  const columns: Record<string, number> = {}
  if (kind !== 'unknown') {
    const keys = new Set(kindSpec(kind).fields.map((f) => f.key))
    for (const [k, v] of Object.entries(ai.columns ?? {})) if (keys.has(k) && Number.isInteger(v) && v >= 0 && v < colCount) columns[k] = v
  }
  if (kind === code.kind && kind !== 'unknown') {
    return { ...code, confidence: ai.confidence === 'low' ? 'medium' : 'high', columns: { ...columns, ...code.columns }, reason: `${code.reason} · AI 같은 판단(${ai.reason.slice(0, 80)})`, source: 'ai' }
  }
  if (code.kind === 'unknown' && kind !== 'unknown') {
    return { kind, confidence: ai.confidence === 'high' ? 'medium' : 'low', headerRow: Number.isInteger(ai.header_row) ? ai.header_row : code.headerRow, columns, reason: `AI: ${ai.reason.slice(0, 120)}`, source: 'ai' }
  }
  return { ...code, confidence: 'low', reason: `코드 «${code.kind}» · AI «${ai.kind}» 판단이 다릅니다 — 종류를 골라 주세요.`, source: 'ai' }
}

/* ───────────────────────── d. 읽기 ───────────────────────── */

export type Rec = Record<string, string | number | null> & { row_no: number }

const TOTAL_LABEL = /^(합계|총계|총합계|계|소계|월계|누계|total|grandtotal)$/i

function num(c: EcountCell | undefined): number | null | 'bad' {
  if (!c || c.t === 'empty') return null
  if (c.t === 'number') return c.v
  if (c.t === 'text') {
    const t = c.v.replace(/[,\s원₩$]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/^△/, '-').replace(/^▲/, '-')
    if (t === '' || t === '-') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : 'bad'
  }
  return 'bad'
}

function dateOf(c: EcountCell | undefined): string | null | 'bad' {
  if (!c || c.t === 'empty') return null
  if (c.t === 'date') return c.v
  const t = cellText(c).trim()
  const m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const m2 = /^(\d{1,2})[./-](\d{1,2})$/.exec(t)
  if (m2) return `0000-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  if (c.t === 'number' && c.v > 20000 && c.v < 80000) return new Date(Date.UTC(1899, 11, 30) + c.v * 86_400_000).toISOString().slice(0, 10)
  return 'bad'
}

export interface ReadResult {
  rows: Rec[]
  /** 급여 개인 줄(사번 · 줄 번호만) */
  people: Rec[]
  /** 파일 안 합계 줄의 값(sumField) */
  fileTotal: number | null
  problems: string[]
  dates: string[]
}

export function readRows(sheet: EcountSheet, cls: Classification): ReadResult {
  if (cls.kind === 'unknown') return { rows: [], people: [], fileTotal: null, problems: ['종류를 모릅니다.'], dates: [] }
  if (cls.kind === 'ledger') return readLedger(sheet)
  const spec = kindSpec(cls.kind)
  const rows: Rec[] = []
  const problems: string[] = []
  const dates: string[] = []
  let fileTotal: number | null = null
  const firstText = spec.fields.find((f) => f.type === 'text' && f.required)?.key
  const personRefCol = (sheet.rows[cls.headerRow] ?? []).findIndex((c) => /사번|사원번호|직원번호/.test(normalizeLabel(cellText(c))))
  for (let r = cls.headerRow + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r]
    if (row.every((c) => c.t === 'empty')) continue
    const labelCells = row.slice(0, 4).map((c) => normalizeLabel(cellText(c)))
    if (labelCells.some((l) => TOTAL_LABEL.test(l))) {
      if (spec.sumField && cls.columns[spec.sumField] !== undefined) {
        const v = num(row[cls.columns[spec.sumField]])
        if (typeof v === 'number') fileTotal = v
      }
      continue
    }
    const rec: Rec = { row_no: r + 1 }
    let bad = false
    for (const field of spec.fields) {
      const col = cls.columns[field.key]
      const cell = col === undefined ? undefined : row[col]
      if (field.type === 'number') {
        const v = num(cell)
        if (v === 'bad') {
          problems.push(`${r + 1}행 «${field.label}» 칸이 숫자가 아닙니다.`)
          bad = true
        }
        rec[field.key] = v === 'bad' ? null : v
      } else if (field.type === 'date') {
        const v = dateOf(cell)
        if (v === 'bad') {
          problems.push(`${r + 1}행 «${field.label}» 날짜를 읽지 못했습니다.`)
          bad = true
        }
        rec[field.key] = v === 'bad' ? null : v
        if (typeof v === 'string') dates.push(v)
      } else {
        const t = cellText(cell).trim().slice(0, 200)
        rec[field.key] = field.key === 'card_last4' ? (/(\d{4})\D*$/.exec(t)?.[1] ?? null) : t || null
      }
    }
    if (firstText && !rec[firstText]) continue // 제목 · 빈 이름 줄
    if (bad) continue
    if (cls.kind === 'payroll') rec.person_ref = personRefCol >= 0 ? cellText(row[personRefCol]).slice(0, 40) || `row-${r + 1}` : `row-${r + 1}`
    rows.push(rec)
  }
  if (cls.kind === 'payroll') {
    // 부서 합계 줄 · 개인 줄로 나눈다. 개인 줄에는 이름이 없다(버리기 뒤) — 사번 · 줄 번호만.
    const people = rows.map((x) => ({ row_no: x.row_no, dept: x.dept, person_ref: x.person_ref, salary: x.salary, bonus: x.bonus, severance: x.severance }))
    const byDept = new Map<string, Rec>()
    for (const p of people) {
      const d = String(p.dept)
      const cur = byDept.get(d) ?? { row_no: 0, dept: d, salary: 0, bonus: 0, severance: 0 }
      for (const k of ['salary', 'bonus', 'severance'] as const) cur[k] = Number(cur[k] ?? 0) + Number(p[k] ?? 0)
      byDept.set(d, cur)
    }
    return { rows: [...byDept.values()], people, fileTotal, problems, dates }
  }
  return { rows, people: [], fileTotal, problems, dates }
}

/** ⑤ 계정별 원장 — 계정마다 블록: 제목 «<코드>(<계정명>)» → 머리글 → 이월잔액 → 거래 줄 → 합계. 그 달 계정별 차변 · 대변 합. */
export function readLedger(sheet: EcountSheet): ReadResult {
  const rows: Rec[] = []
  const problems: string[] = []
  const dates: string[] = []
  let cur: { code: string; name: string; debit: number; credit: number; total: { d: number; c: number } | null; row: number } | null = null
  let debitCol = -1
  let creditCol = -1
  const flush = () => {
    if (!cur) return
    if (cur.total && (Math.abs(cur.total.d - cur.debit) > 1 || Math.abs(cur.total.c - cur.credit) > 1)) {
      problems.push(`계정 ${cur.code}(${cur.name}) 거래 합이 합계 줄과 다릅니다 — 차변 ${cur.debit} ≠ ${cur.total.d} 또는 대변 ${cur.credit} ≠ ${cur.total.c}.`)
    }
    rows.push({ row_no: cur.row, account_code: cur.code, account_name: cur.name, debit: cur.debit, credit: cur.credit })
    cur = null
  }
  sheet.rows.forEach((row, r) => {
    const line = row.map(cellText).join(' ')
    const head = /계정별\s*원장[^\d]*?(\d{3,6})\s*\(([^)]+)\)/.exec(line) ?? (/^\s*(\d{3,6})\s*\(([^)]+)\)\s*$/.exec(line.trim()) ? /(\d{3,6})\s*\(([^)]+)\)/.exec(line) : null)
    if (head) {
      flush()
      cur = { code: head[1], name: head[2].trim(), debit: 0, credit: 0, total: null, row: r + 1 }
      return
    }
    const labels = row.map((c) => normalizeLabel(cellText(c)))
    const di = labels.findIndex((l) => l === '차변' || l === '차변금액')
    const ci = labels.findIndex((l) => l === '대변' || l === '대변금액')
    if (di >= 0 && ci >= 0) {
      debitCol = di
      creditCol = ci
      return
    }
    if (!cur || debitCol < 0) return
    if (labels.some((l) => /이월잔액|전기이월|전월이월/.test(l))) return
    if (labels.some((l) => /^(합계|월계|누계|총계)$/.test(l))) {
      if (labels.some((l) => l === '합계' || l === '월계')) {
        const d = num(row[debitCol])
        const c = num(row[creditCol])
        cur.total = { d: typeof d === 'number' ? d : 0, c: typeof c === 'number' ? c : 0 }
      }
      return
    }
    const date = dateOf(row[0])
    if (typeof date !== 'string') return // 출력 시각 · 빈 줄
    const d = num(row[debitCol])
    const c = num(row[creditCol])
    if (d === 'bad' || c === 'bad') {
      problems.push(`${r + 1}행 차변 · 대변이 숫자가 아닙니다.`)
      return
    }
    cur.debit += d ?? 0
    cur.credit += c ?? 0
    dates.push(date)
  })
  flush()
  return { rows, people: [], fileTotal: null, problems, dates }
}

/* ───────────────────────── 기간 ───────────────────────── */

/** 제목 줄의 기간(한 달) → 날짜 칸의 가장 많은 달 → 파일 이름. 못 찾으면 null(사람이 고른다). */
export function detectMonth(sheet: EcountSheet, dates: string[], fileName: string, today = new Date()): { period: string | null; how: string } {
  for (const row of sheet.rows.slice(0, 10)) {
    const p = detectPeriod(row.map(cellText).join(' '))
    if (p && p.from.slice(0, 7) === p.to.slice(0, 7)) return { period: p.from.slice(0, 7), how: `제목 «${p.from} ~ ${p.to}»` }
    if (p) return { period: p.to.slice(0, 7), how: `제목 기간의 끝 달(${p.from} ~ ${p.to})` }
  }
  const months = dates.filter((d) => !d.startsWith('0000')).map((d) => d.slice(0, 7))
  if (months.length) {
    const count = new Map<string, number>()
    for (const m of months) count.set(m, (count.get(m) ?? 0) + 1)
    const top = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0]
    return { period: top, how: `날짜 칸에서 가장 많은 달(${count.size}개 달 중)` }
  }
  const name = fileName.normalize('NFKC')
  const ym = /(20\d{2})[.\-_년 ]*(0?[1-9]|1[0-2])\s*월?/.exec(name)
  if (ym) return { period: `${ym[1]}-${ym[2].padStart(2, '0')}`, how: '파일 이름' }
  const yy = /(\d{2})년\s*(0?[1-9]|1[0-2])월/.exec(name)
  if (yy) return { period: `20${yy[1]}-${yy[2].padStart(2, '0')}`, how: '파일 이름' }
  const mOnly = /(?:^|\D)(0?[1-9]|1[0-2])월/.exec(name)
  if (mOnly) return { period: `${today.getFullYear()}-${mOnly[1].padStart(2, '0')}`, how: '파일 이름의 달(해는 올해)' }
  return { period: null, how: '기간을 찾지 못했습니다' }
}

/* ───────────────────────── e. 검증 · f. 판정 ───────────────────────── */

export interface Check {
  errors: string[]
  warnings: string[]
}

const CURRENCY = /^(KRW|USD|EUR|JPY|CNY|VND|GBP|원|달러|엔|위안|동)$/i

export function validate(kind: UploadKind, read: ReadResult, period: string | null): Check {
  const spec = kindSpec(kind)
  const errors = [...read.problems]
  const warnings: string[] = []
  if (!read.rows.length) errors.push('넣을 줄이 없습니다.')
  if (!period) errors.push('기간(달)을 찾지 못했습니다 — 골라 주세요.')
  if (spec.sumField && read.fileTotal !== null) {
    const sum = read.rows.reduce((a, r) => a + Number(r[spec.sumField!] ?? 0), 0)
    if (Math.abs(sum - read.fileTotal) > 1) errors.push(`합계가 맞지 않습니다 — 줄의 합 ${sum.toLocaleString('ko-KR')} · 파일 합계 줄 ${read.fileTotal.toLocaleString('ko-KR')}.`)
  } else if (spec.sumField) {
    warnings.push('파일에 합계 줄이 없어 대조하지 못했습니다.')
  }
  for (const r of read.rows) {
    for (const f of spec.fields) {
      const v = r[f.key]
      if (f.type === 'number' && typeof v === 'number' && v < 0 && !['inflow', 'outflow', 'amount'].includes(f.key)) {
        warnings.push(`${r.row_no}행 «${f.label}»가 음수입니다.`)
      }
      if (f.type === 'date' && typeof v === 'string' && v.startsWith('0000')) warnings.push(`${r.row_no}행 «${f.label}»에 해가 없습니다.`)
      if (f.key === 'currency' && typeof v === 'string' && v && !CURRENCY.test(v)) warnings.push(`${r.row_no}행 통화 «${v}»를 모릅니다.`)
    }
    if (kind === 'sales' && typeof r.amount === 'number' && r.amount < 0) warnings.push(`${r.row_no}행 판매금액이 음수(반품?)입니다.`)
  }
  return { errors: [...new Set(errors)].slice(0, 30), warnings: [...new Set(warnings)].slice(0, 30) }
}

export interface AutoInput {
  confidence: Confidence
  check: Check
  overlap: boolean
  closed: boolean
}

/** 자동으로 넣는 네 조건(대표 결정 2f). 하나라도 아니면 미리보기 — 왜인지 한 줄씩. */
export function autoDecision(x: AutoInput): { auto: boolean; why: string[] } {
  const why: string[] = []
  if (x.confidence !== 'high') why.push(`분류 믿음이 «높음»이 아닙니다(${CONF_KO[x.confidence]}).`)
  if (x.check.errors.length || x.check.warnings.length) why.push(`검증 ${x.check.errors.length + x.check.warnings.length}건.`)
  if (x.overlap) why.push('같은 달에 이미 넣은 자료가 있습니다(겹침 — 새 값 · 기존 값 중 고르세요).')
  if (x.closed) why.push('마감된 달입니다(대표 · CFO가 이유를 적고 넣습니다).')
  return { auto: why.length === 0, why }
}

export const CONF_KO: Record<Confidence, string> = { high: '높음', medium: '보통', low: '낮음', none: '없음' }

/** AI에 보내는 시트 견본 — 시트명 · 머리글 · 앞 20줄 · 합계 줄(버리기 뒤). 전체 숫자를 보내지 않는다. */
export function aiSample(sheet: EcountSheet, headerRow: number): { sheet: string; rows: string[][] } {
  const start = Math.max(0, headerRow - 3)
  const take = sheet.rows.slice(start, start + 23)
  const totals = sheet.rows.filter((r) => r.slice(0, 4).some((c) => TOTAL_LABEL.test(normalizeLabel(cellText(c))))).slice(0, 3)
  const asText = (r: EcountCell[]) => r.map((c) => cellText(c).slice(0, 60))
  return { sheet: sheet.name.slice(0, 80), rows: [...take, ...totals].map(asText) }
}
