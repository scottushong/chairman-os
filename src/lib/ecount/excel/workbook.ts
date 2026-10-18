import { createHash } from 'node:crypto'

import { unzipSync } from 'fflate'

import { EMPTY_CELL, normalizeCell, type EcountCell, type EcountUnit } from './cells'
import { findPeriod, findUnit, type EcountPeriod } from './detect'
import { ecountBytesProblem } from './file-rules'

/**
 * ECOUNT 엑셀(xlsx)을 읽는다 — **서버에서만**(서버 액션이 Storage에서 다시 읽은 바이트로). exceljs를 쓴다:
 * npm `xlsx` 0.18.x는 미패치 CVE가 있어 쓰지 않는다(lib/attachments/extract.ts와 같은 판단 — 믿을 수 없는 파일이다).
 *
 * 결과는 시트마다 «정규화된 칸의 격자»다. 대상별(계정과목 · 연간 · 월별) 판정은 이 격자만 본다 — 열 구성이
 * 확정되면 그 단계가 detect.ts의 머리글 · 행 종류 함수로 매핑을 만든다.
 *
 * 상한: 압축을 풀면 50MB · 시트당 1만 행 · 100열. ECOUNT 내보내기(계정 수백 줄 · 월별 수십 줄 × 14열)는
 * 한참 아래다. 넘으면 «ECOUNT 파일이 아닐 수 있다»로 끊는다 — 함수 메모리 전에.
 */

export class EcountExcelError extends Error {}

export const ECOUNT_MAX_ROWS = 10_000
export const ECOUNT_MAX_COLS = 100
const ZIP_MAX_UNPACKED = 50 * 1024 * 1024
const ZIP_MAX_ENTRIES = 2_000

export interface EcountSheet {
  name: string
  /** rows[r][c] — 0부터. 모든 행이 같은 길이(colCount)다. 병합 칸은 왼쪽 위(주인) 칸에만 값이 있고 나머지는 빈 칸이다. */
  rows: EcountCell[][]
  colCount: number
  /** 엑셀에서 숨긴 시트(hidden · veryHidden) — 자료 올리기는 건너뛰고 수를 알린다. ECOUNT 업로드는 쓰지 않는다. */
  hidden?: boolean
}

/** 원본 바이트의 sha256(소문자 hex 64자) — 0050 finance_imports.file_sha256. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 압축 해제 크기 합을 머리(중앙 디렉터리)만 읽어 잰다 — zip bomb을 풀기 전에 끊는다(extract.ts guardZip과 같은 수법). */
function guardZip(bytes: Uint8Array) {
  let total = 0
  let entries = 0
  try {
    unzipSync(bytes, {
      filter(file) {
        total += file.originalSize
        entries += 1
        return false
      },
    })
  } catch {
    throw new EcountExcelError('파일이 손상되었거나 엑셀(xlsx) 형식이 아닙니다.')
  }
  if (total > ZIP_MAX_UNPACKED || entries > ZIP_MAX_ENTRIES) {
    throw new EcountExcelError('압축을 풀면 너무 큰 파일입니다. ECOUNT에서 내려받은 원본이 맞는지 확인하세요.')
  }
}

/** exceljs가 쓰는 칸 · 행 · 시트의 모양 중 여기서 읽는 것만. */
interface XCell {
  value: unknown
  master: XCell
}
interface XRow {
  findCell(col: number): XCell | undefined
}
interface XSheet {
  name: string
  state?: string
  rowCount: number
  columnCount: number
  findRow(row: number): XRow | undefined
}

export async function readEcountWorkbook(bytes: Uint8Array): Promise<EcountSheet[]> {
  const problem = ecountBytesProblem(bytes)
  if (problem) throw new EcountExcelError(problem)
  guardZip(bytes)

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    // exceljs의 타입은 옛 Buffer 모양을 요구한다 — 바이트는 그대로다.
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  } catch {
    throw new EcountExcelError('엑셀(xlsx) 파일을 읽지 못했습니다. 엑셀에서 열어 xlsx로 다시 저장한 뒤 올리세요.')
  }

  const sheets: EcountSheet[] = []
  for (const ws of wb.worksheets as unknown as XSheet[]) {
    if (ws.rowCount > ECOUNT_MAX_ROWS) throw new EcountExcelError(`시트 «${ws.name}»가 ${ECOUNT_MAX_ROWS.toLocaleString('ko-KR')}행을 넘습니다. ECOUNT 원본이 맞는지 확인하세요.`)
    if (ws.columnCount > ECOUNT_MAX_COLS) throw new EcountExcelError(`시트 «${ws.name}»가 ${ECOUNT_MAX_COLS}열을 넘습니다. ECOUNT 원본이 맞는지 확인하세요.`)
    const colCount = ws.columnCount
    const rows: EcountCell[][] = []
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.findRow(r)
      const out: EcountCell[] = new Array(colCount)
      for (let c = 1; c <= colCount; c += 1) {
        const cell = row?.findCell(c)
        // 병합의 나머지 칸(주인이 아닌 칸)은 exceljs가 주인 값을 돌려준다 — 그대로 읽으면 금액이 두 번 선다.
        out[c - 1] = !cell || cell.master !== cell ? EMPTY_CELL : normalizeCell(cell.value)
      }
      rows.push(out)
    }
    sheets.push({ name: ws.name, rows, colCount, ...(ws.state === 'hidden' || ws.state === 'veryHidden' ? { hidden: true } : {}) })
  }
  if (sheets.length === 0) throw new EcountExcelError('시트가 없는 파일입니다.')
  return sheets
}

export interface SheetOutline {
  name: string
  /** 칸이 하나라도 찬 행 수 */
  rows: number
  cols: number
  period: EcountPeriod | null
  unit: EcountUnit | null
  /** 읽지 못한 칸 수(수식 결과 없음 · 셀 오류) — 대상별 판정이 어느 칸이 쓰이는지 보고 차단한다. */
  errorCells: number
}

/**
 * finance_imports.summary(jsonb)에서 개요를 다시 읽는다. summary는 만든 사람이 PostgREST로도 고칠 수 있는 칸이라
 * 모양을 믿지 않는다 — 한 칸이라도 틀리면 null(화면이 개요를 안 그릴 뿐이다).
 */
export function outlineFromSummary(summary: unknown): SheetOutline[] | null {
  const sheets = summary && typeof summary === 'object' ? (summary as { sheets?: unknown }).sheets : undefined
  if (!Array.isArray(sheets) || sheets.length > 50) return null
  const isPeriod = (p: unknown) =>
    p === null || (!!p && typeof p === 'object' && typeof (p as EcountPeriod).from === 'string' && typeof (p as EcountPeriod).to === 'string')
  const ok = sheets.every(
    (s) =>
      s && typeof s === 'object' &&
      typeof s.name === 'string' && Number.isInteger(s.rows) && Number.isInteger(s.cols) && Number.isInteger(s.errorCells) &&
      isPeriod(s.period) && (s.unit === null || s.unit === 'won' || s.unit === 'thousand' || s.unit === 'million'),
  )
  return ok ? (sheets as SheetOutline[]).map((s) => ({ ...s, name: s.name.slice(0, 100) })) : null
}

/**
 * 시트마다 개요 — 미리보기 공통부가 finance_imports.summary에 적는다. **금액 원문은 담지 않는다**(원본은 첨부다).
 */
export function outlineWorkbook(sheets: EcountSheet[]): SheetOutline[] {
  return sheets.map((s) => {
    let rows = 0
    let errorCells = 0
    for (const row of s.rows) {
      let filled = false
      for (const c of row) {
        if (c.t !== 'empty') filled = true
        if (c.t === 'error') errorCells += 1
      }
      if (filled) rows += 1
    }
    return {
      name: s.name,
      rows,
      cols: s.colCount,
      period: findPeriod(s.rows)?.value ?? null,
      unit: findUnit(s.rows)?.value ?? null,
      errorCells,
    }
  })
}
