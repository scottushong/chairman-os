import { cellText, EMPTY_CELL, normalizeCell, type EcountCell } from '@/lib/ecount/excel/cells'
import { EcountExcelError, readEcountWorkbook, sha256Hex, type EcountSheet } from '@/lib/ecount/excel/workbook'

/**
 * 2a. 열기(코드) — 엑셀(xlsx · csv)은 모든 시트를 칸 격자로. PDF · 사진은 여기서 형식만 알아보고 C단계(process.ts processDoc ·
 * doc-open.ts)가 연다 — 입구 스위치가 꺼진 사람에게는 «준비 중»(pdfLater).
 * 못 여는 파일은 **이유를 문구로** 돌려준다(DRM · 암호 · 옛 xls · 이름만 xlsx · 깨진 파일).
 */

export type OpenResult =
  | { ok: true; format: 'xlsx' | 'csv'; sheets: EcountSheet[]; sha256: string }
  | { ok: false; format: 'pdf' | 'image' | 'xls' | 'unknown' | 'broken'; sha256: string; message: string }

export const UPLOAD_ACCEPT = '.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png'
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024

export const MSG = {
  drm: '암호 · DRM이 걸린 파일이거나 옛 엑셀(.xls)입니다 — 엑셀에서 열어 암호 · DRM을 풀고 «다른 이름으로 저장 → Excel 통합 문서(.xlsx)»로 저장해 올려 주세요.',
  fakeXlsx: '이름은 엑셀인데 내용이 엑셀이 아닙니다(웹 표 · 텍스트일 수 있습니다) — 엑셀에서 열어 xlsx로 다시 저장해 올려 주세요.',
  broken: '파일이 깨져 열 수 없습니다 — 원본을 다시 내려받아 올려 주세요.',
  pdfLater: 'PDF · 사진은 준비 중입니다 — 같은 자료를 엑셀로 내려받아 올려 주세요(엑셀은 그대로 받습니다).',
  payrollDoc: '급여대장은 엑셀로 올려 주세요 — PDF · 사진은 이름 · 주민번호를 지울 수 없어 AI에 보내지 않습니다.',
  productionDoc: '제조지시명세서는 엑셀로 올려 주세요 — PDF · 사진은 원료 투입 줄을 지울 수 없어 AI에 보내지 않습니다.',
  tooBig: '20MB가 넘는 파일입니다 — 기간을 나눠 내려받아 올려 주세요.',
} as const

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const isOle = (b: Uint8Array) => b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x)
const isPdf = (b: Uint8Array) => b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-'
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** CSV 한 덩이 → 시트 하나(따옴표 · 쉼표 · 줄바꿈). 숫자 모양은 숫자 칸으로. */
export function parseCsv(text: string, name = 'CSV'): EcountSheet {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
    } else cur += c
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  const colCount = Math.min(100, Math.max(0, ...rows.map((r) => r.length)))
  const cells: EcountCell[][] = rows.slice(0, 10_000).map((r) => {
    const out: EcountCell[] = new Array(colCount).fill(EMPTY_CELL)
    r.slice(0, colCount).forEach((v, i) => {
      const t = v.trim()
      const n = /^-?[\d,]+(\.\d+)?$/.test(t) ? Number(t.replace(/,/g, '')) : NaN
      out[i] = Number.isFinite(n) && t !== '' ? { t: 'number', v: n } : normalizeCell(t)
    })
    return out
  })
  return { name, rows: cells, colCount }
}

export async function openUpload(bytes: Uint8Array, fileName: string): Promise<OpenResult> {
  const sha256 = sha256Hex(bytes)
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, format: 'unknown', sha256, message: MSG.tooBig }
  const lower = fileName.toLowerCase()
  if (isPdf(bytes)) return { ok: false, format: 'pdf', sha256, message: MSG.pdfLater }
  if (isJpeg(bytes) || isPng(bytes)) return { ok: false, format: 'image', sha256, message: MSG.pdfLater }
  if (isOle(bytes)) return { ok: false, format: 'xls', sha256, message: MSG.drm }
  if (isZip(bytes)) {
    try {
      return { ok: true, format: 'xlsx', sheets: await readEcountWorkbook(bytes), sha256 }
    } catch (e) {
      return { ok: false, format: 'broken', sha256, message: e instanceof EcountExcelError ? e.message : MSG.broken }
    }
  }
  if (lower.endsWith('.csv')) {
    // CSV는 UTF-8(BOM 포함) · 아니면 EUC-KR(ECOUNT 기본)로 읽는다.
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '')
    if (text.includes('�')) {
      try {
        text = new TextDecoder('euc-kr').decode(bytes)
      } catch {
        // 그대로
      }
    }
    return { ok: true, format: 'csv', sheets: [parseCsv(text)], sha256 }
  }
  if (/\.(xlsx|xls)$/.test(lower)) return { ok: false, format: 'unknown', sha256, message: MSG.fakeXlsx }
  return { ok: false, format: 'unknown', sha256, message: '받는 형식은 엑셀(xlsx · xls · csv) · PDF · jpg · png입니다.' }
}

export { cellText }
