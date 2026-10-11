import 'server-only'

import { createHash } from 'node:crypto'

import { unzipSync } from 'fflate'

import { cellText, normalizeCell } from '@/lib/ecount/excel/cells'
import { ecountBytesProblem } from '@/lib/ecount/excel/file-rules'

import type { GridCell, GridSheet } from './plan'

/**
 * 원가 엔진 엑셀 넣기 — xlsx를 **서버에서 코드로만** 읽는다(exceljs). 어떤 AI 경로에도 보내지 않는다(BOM · 원가 엑셀 — 회장 규칙).
 * 파일은 어디에도 저장하지 않는다(Storage · 임시 파일 · 로그 없음). 서버 액션 본문의 바이트를 읽고 버린다.
 * 오류 문장에 칸 값을 싣지 않는다(BOM 평문 노출 막기).
 *
 * 상한: 압축을 풀면 20MB · 시트당 5천 행 · 60열 — 넘으면 «원가 자료 파일이 아닐 수 있다»로 끊는다.
 */

export class CostImportFileError extends Error {}

const MAX_ROWS = 5_000
const MAX_COLS = 60
const ZIP_MAX_UNPACKED = 20 * 1024 * 1024
const ZIP_MAX_ENTRIES = 500

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

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
    throw new CostImportFileError('파일이 손상되었거나 엑셀(xlsx) 형식이 아닙니다.')
  }
  if (total > ZIP_MAX_UNPACKED || entries > ZIP_MAX_ENTRIES) throw new CostImportFileError('압축을 풀면 너무 큰 파일입니다.')
}

interface XCell {
  value: unknown
  master: XCell
}
interface XRow {
  findCell(col: number): XCell | undefined
}
interface XSheet {
  name: string
  rowCount: number
  columnCount: number
  findRow(row: number): XRow | undefined
}

export async function readCostWorkbook(bytes: Uint8Array): Promise<GridSheet[]> {
  const problem = ecountBytesProblem(bytes)
  if (problem) throw new CostImportFileError(problem)
  guardZip(bytes)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  } catch {
    throw new CostImportFileError('엑셀(xlsx) 파일을 읽지 못했습니다. 엑셀에서 열어 xlsx로 다시 저장한 뒤 올리세요.')
  }
  const sheets: GridSheet[] = []
  for (const ws of wb.worksheets as unknown as XSheet[]) {
    if (ws.rowCount > MAX_ROWS) throw new CostImportFileError(`시트 «${ws.name.slice(0, 40)}»가 ${MAX_ROWS.toLocaleString('ko-KR')}행을 넘습니다.`)
    if (ws.columnCount > MAX_COLS) throw new CostImportFileError(`시트 «${ws.name.slice(0, 40)}»가 ${MAX_COLS}열을 넘습니다.`)
    const rows: GridCell[][] = []
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.findRow(r)
      const out: GridCell[] = []
      for (let c = 1; c <= ws.columnCount; c += 1) {
        const cell = row?.findCell(c)
        const n = !cell || cell.master !== cell ? null : normalizeCell(cell.value)
        out.push(!n ? { v: '' } : n.t === 'error' ? { v: '', err: n.v } : { v: cellText(n).slice(0, 1000) })
      }
      rows.push(out)
    }
    sheets.push({ name: ws.name.slice(0, 100), rows })
  }
  if (sheets.length === 0) throw new CostImportFileError('시트가 없는 파일입니다.')
  return sheets
}
