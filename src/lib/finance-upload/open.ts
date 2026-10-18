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
  oldXls: '옛 엑셀(.xls · 97-2003) 파일입니다 — 이 형식은 서버에서 열지 않습니다(새 의존성 없이 읽을 수 없음). 엑셀에서 열어 «다른 이름으로 저장 → Excel 통합 문서(.xlsx)»로 저장해 올려 주세요.',
  encrypted: '암호가 걸린 엑셀입니다 — 엑셀에서 암호를 풀고 다시 저장해 올려 주세요.',
  photoFormat: 'HEIC · WEBP 사진은 받지 않습니다 — 휴대폰 설정에서 «호환성 우선»으로 찍거나 JPG로 저장해 올려 주세요.',
  csvTooLong: (n: number) => `CSV가 ${n.toLocaleString('ko-KR')}줄입니다 — 1만 줄까지 받습니다(잘라 넣지 않습니다). 기간을 나눠 내려받아 올려 주세요.`,
  docSwitchOff: (audience: string | null) =>
    `PDF · 사진 읽기는 ${audience ? `지금 «${audience}» 쓸 수 있습니다` : '지금 꺼져 있습니다'}(기능 스위치 «PDF · 사진 읽기»). 같은 자료를 엑셀로 올려 주세요 — 엑셀은 그대로 받습니다.`,
  docNoAi: 'PDF · 사진을 읽는 AI가 서버에 설정되어 있지 않습니다(키 · 한도)',
} as const

/** CSV · HTML 표 한 장의 줄 천장(엑셀 ECOUNT_MAX_ROWS와 같은 뜻 — 넘으면 자르지 않고 거부). */
export const TEXT_SHEET_MAX_ROWS = 10_000

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const isOle = (b: Uint8Array) => b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x)
const isPdf = (b: Uint8Array) => b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-'
const isJpeg = (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to))
/** HEIC(ftypheic · mif1 …) · WEBP(RIFF....WEBP) */
const isHeicOrWebp = (b: Uint8Array) => (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))) || (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP')

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
  return textGridSheet(name, rows)
}

export class SheetTooLongError extends Error {}

/** 글 칸 격자(CSV · HTML 표) → 시트. 숫자 모양은 숫자 칸으로. 1만 줄을 넘으면 자르지 않고 SheetTooLongError(끝의 빈 줄은 세지 않는다). */
export function textGridSheet(name: string, rows: string[][]): EcountSheet {
  let end = rows.length
  while (end > 0 && rows[end - 1].every((v) => !v.trim())) end -= 1
  if (end > TEXT_SHEET_MAX_ROWS) throw new SheetTooLongError(MSG.csvTooLong(end))
  const colCount = Math.min(100, Math.max(0, ...rows.slice(0, end).map((r) => r.length)))
  const cells: EcountCell[][] = rows.slice(0, end).map((r) => {
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

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITY[e.toLowerCase()] ?? m),
  )

/**
 * «엑셀로 내려받기»가 만든 HTML 표(.xls 이름의 웹 표 — ECOUNT · 은행 내려받기에 흔하다) → 표마다 시트.
 * 정규식으로 <tr> · <td>/<th>만 읽는다(스크립트 · 서식은 버린다). colspan은 빈칸으로 자리를 지킨다. 표가 없으면 빈 목록.
 */
export function parseHtmlTables(html: string): EcountSheet[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  const sheets: EcountSheet[] = []
  for (const [i, t] of [...body.matchAll(/<table[\s\S]*?<\/table>/gi)].entries()) {
    const rows: string[][] = []
    for (const tr of t[0].matchAll(/<tr[\s\S]*?(?:<\/tr>|(?=<tr)|$)/gi)) {
      const row: string[] = []
      for (const td of tr[0].matchAll(/<t([dh])([^>]*)>([\s\S]*?)(?=<\/t[dh]>|<t[dh][\s>]|$)/gi)) {
        const text = decodeEntities(td[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
        row.push(text)
        const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] ?? 1)
        for (let k = 1; k < Math.min(span, 50); k += 1) row.push('')
      }
      if (row.length) rows.push(row)
    }
    if (rows.length) sheets.push(textGridSheet(`표${i + 1}`, rows))
  }
  return sheets
}

/** OLE(옛 xls · 암호 엑셀 · DRM) 안의 흐름 이름(UTF-16) — 무엇인지 가려 문구를 고른다. */
export function oleKind(b: Uint8Array): 'xls' | 'encrypted' | 'other' {
  const has = (name: string) => {
    const u16 = new Uint8Array(name.length * 2)
    for (let i = 0; i < name.length; i += 1) u16[i * 2] = name.charCodeAt(i)
    outer: for (let i = 0; i + u16.length <= b.length; i += 2) {
      for (let j = 0; j < u16.length; j += 1) if (b[i + j] !== u16[j]) continue outer
      return true
    }
    return false
  }
  if (has('EncryptedPackage') || has('EncryptionInfo')) return 'encrypted'
  if (has('Workbook') || has('Book')) return 'xls'
  return 'other'
}

const looksHtml = (b: Uint8Array) => /^\s*(<\?xml[^>]*>\s*)?(<!doctype html|<html|<table|<meta|<style)/i.test(new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 2048)).replace(/^﻿/, ''))

function decodeText(bytes: Uint8Array): string {
  // UTF-8(BOM 포함) · 아니면 EUC-KR(ECOUNT 기본)로 읽는다.
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '')
  if (text.includes('�')) {
    try {
      text = new TextDecoder('euc-kr').decode(bytes)
    } catch {
      // 그대로
    }
  }
  return text
}

/** 숨긴 시트 수(카드 안내) — readEcountWorkbook이 시트에 hidden을 적는다. */
export function hiddenSheetCount(sheets: EcountSheet[]): number {
  return sheets.filter((s) => s.hidden).length
}

export async function openUpload(bytes: Uint8Array, fileName: string): Promise<OpenResult> {
  const sha256 = sha256Hex(bytes)
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, format: 'unknown', sha256, message: MSG.tooBig }
  const lower = fileName.toLowerCase()
  if (isPdf(bytes)) return { ok: false, format: 'pdf', sha256, message: MSG.pdfLater }
  if (isJpeg(bytes) || isPng(bytes)) return { ok: false, format: 'image', sha256, message: MSG.pdfLater }
  if (isHeicOrWebp(bytes) || /\.(heic|heif|webp)$/.test(lower)) return { ok: false, format: 'unknown', sha256, message: MSG.photoFormat }
  if (isOle(bytes)) {
    const k = oleKind(bytes)
    return { ok: false, format: 'xls', sha256, message: k === 'xls' ? MSG.oldXls : k === 'encrypted' ? MSG.encrypted : MSG.drm }
  }
  if (isZip(bytes)) {
    try {
      return { ok: true, format: 'xlsx', sheets: await readEcountWorkbook(bytes), sha256 }
    } catch (e) {
      return { ok: false, format: 'broken', sha256, message: e instanceof EcountExcelError ? e.message : MSG.broken }
    }
  }
  try {
    if (lower.endsWith('.csv')) return { ok: true, format: 'csv', sheets: [parseCsv(decodeText(bytes))], sha256 }
    // .xls 이름의 웹 표(HTML) — 표를 칸 격자로 바꿔 받는다(변환 시도). 표가 없으면 예전 문구.
    if (/\.(xlsx|xls|htm|html)$/.test(lower) && looksHtml(bytes)) {
      const sheets = parseHtmlTables(decodeText(bytes))
      if (sheets.length) return { ok: true, format: 'csv', sheets, sha256 }
    }
  } catch (e) {
    if (e instanceof SheetTooLongError) return { ok: false, format: 'unknown', sha256, message: e.message }
    throw e
  }
  if (/\.(xlsx|xls)$/.test(lower)) return { ok: false, format: 'unknown', sha256, message: MSG.fakeXlsx }
  return { ok: false, format: 'unknown', sha256, message: '받는 형식은 엑셀(xlsx · xls · csv) · PDF · jpg · png입니다.' }
}

export { cellText }
